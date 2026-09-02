import AppKit
import Darwin
import Foundation

private let activityProtocolVersion = 1

/// A deliberately small newline-delimited JSON bridge for macOS application
/// awareness.
///
/// The helper is kept separate from Electron so that the privileged platform
/// boundary is easy to audit. It only asks NSWorkspace for application bundle
/// identifiers and localized names. In particular, it never reads windows,
/// URLs, keystrokes, screenshots, or document contents.
@main
private enum FocusFamiliarActivity {
    static func main() {
        let writer = EventWriter()

        do {
            let command = try Command.parse(Array(CommandLine.arguments.dropFirst()))
            try run(command, writer: writer)
        } catch let error as ActivityError {
            writer.emit(.error(
                operation: error.operation,
                code: error.code,
                message: error.message,
                bundleID: error.bundleID
            ))
            Darwin.exit(error.exitCode)
        } catch {
            writer.emit(.error(
                operation: "startup",
                code: "internal-error",
                message: "The activity helper could not complete the request."
            ))
            Darwin.exit(EXIT_FAILURE)
        }
    }

    private static func run(_ command: Command, writer: EventWriter) throws {
        let workspace = NSWorkspace.shared

        switch command {
        case .current:
            guard let application = applicationRecord(workspace.frontmostApplication) else {
                throw ActivityError(
                    operation: "current",
                    code: "no-frontmost-application",
                    message: "No frontmost application is available."
                )
            }
            writer.emit(.current(application))

        case .list:
            let applications = runningApplicationRecords(workspace)
            for application in applications {
                writer.emit(.application(application))
            }
            writer.emit(.complete(operation: "list", count: applications.count))

        case .activate(let bundleID):
            try activate(bundleID: bundleID, workspace: workspace, writer: writer)

        case .observe:
            observe(workspace: workspace, writer: writer)
        }
    }

    private static func activate(
        bundleID: String,
        workspace: NSWorkspace,
        writer: EventWriter
    ) throws {
        guard let application = workspace.runningApplications.first(where: {
            $0.bundleIdentifier == bundleID
        }) else {
            throw ActivityError(
                operation: "activate",
                code: "application-not-running",
                message: "The requested application is not running.",
                bundleID: bundleID
            )
        }

        guard let record = applicationRecord(application) else {
            throw ActivityError(
                operation: "activate",
                code: "application-metadata-unavailable",
                message: "The requested application has no usable bundle identifier.",
                bundleID: bundleID
            )
        }

        // This is an activation request only. It never terminates or otherwise
        // changes another application's state.
        let didActivate = application.activate(options: [])
        if didActivate {
            writer.emit(.activation(
                application: record,
                success: true,
                operation: "activate"
            ))
        } else {
            writer.emit(.activation(
                application: record,
                success: false,
                operation: "activate",
                code: "activation-failed",
                message: "macOS did not accept the activation request."
            ))
        }
    }

    private static func observe(workspace: NSWorkspace, writer: EventWriter) {
        let notificationCenter = workspace.notificationCenter
        var observerTokens: [NSObjectProtocol] = []

        observerTokens.append(notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { _ in
            // Reconcile on the next main-loop turn instead of treating the
            // notification payload as final foreground truth.
            DispatchQueue.main.async {
                guard let application = applicationRecord(
                    NSWorkspace.shared.frontmostApplication
                ) else {
                    writer.emit(.error(
                        operation: "observe",
                        code: "application-metadata-unavailable",
                        message: "The activated application has no usable bundle identifier."
                    ))
                    return
                }

                writer.emit(.activation(application: application, success: true))
            }
        })

        observerTokens.append(notificationCenter.addObserver(
            forName: NSWorkspace.didTerminateApplicationNotification,
            object: nil,
            queue: .main
        ) { notification in
            guard let runningApplication = runningApplication(from: notification) else {
                writer.emit(.error(
                    operation: "observe",
                    code: "malformed-termination-notification",
                    message: "macOS sent a termination notification without application metadata."
                ))
                return
            }

            guard let application = applicationRecord(runningApplication) else {
                writer.emit(.error(
                    operation: "observe",
                    code: "application-metadata-unavailable",
                    message: "The terminated application has no usable bundle identifier."
                ))
                return
            }

            writer.emit(.termination(application))
            DispatchQueue.main.async {
                if let current = applicationRecord(NSWorkspace.shared.frontmostApplication) {
                    writer.emit(.current(current))
                }
            }
        })

        observerTokens.append(notificationCenter.addObserver(
            forName: NSWorkspace.willSleepNotification,
            object: nil,
            queue: .main
        ) { _ in
            writer.emit(.lifecycle(event: "sleep"))
        })

        observerTokens.append(notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil,
            queue: .main
        ) { _ in
            writer.emit(.lifecycle(event: "wake"))
            DispatchQueue.main.async {
                if let current = applicationRecord(NSWorkspace.shared.frontmostApplication) {
                    writer.emit(.current(current))
                } else {
                    writer.emit(.error(
                        operation: "observe",
                        code: "no-frontmost-application",
                        message: "No frontmost application is available after wake."
                    ))
                }
            }
        })

        // The initial snapshot allows the main process to establish its
        // baseline without inventing a foreground transition at startup.
        writer.emit(.ready)
        if let current = applicationRecord(workspace.frontmostApplication) {
            writer.emit(.current(current))
        } else {
            writer.emit(.error(
                operation: "observe",
                code: "no-frontmost-application",
                message: "No frontmost application is available."
            ))
        }

        // Keep the notification observers alive while the helper is attached
        // to the main run loop. The main process owns termination of this
        // child process when observation is no longer needed.
        withExtendedLifetime(observerTokens) {
            RunLoop.main.run()
        }
    }

    private static func runningApplicationRecords(_ workspace: NSWorkspace) -> [ApplicationRecord] {
        workspace.runningApplications
            .filter { $0.activationPolicy == .regular }
            .compactMap(applicationRecord)
            .sorted {
                if $0.name == $1.name {
                    return $0.bundleID < $1.bundleID
                }
                return $0.name.localizedStandardCompare($1.name) == .orderedAscending
            }
    }

    private static func applicationRecord(
        _ application: NSRunningApplication?
    ) -> ApplicationRecord? {
        guard let application else { return nil }
        return applicationRecord(application)
    }

    private static func applicationRecord(
        _ application: NSRunningApplication
    ) -> ApplicationRecord? {
        guard let bundleID = application.bundleIdentifier, !bundleID.isEmpty else {
            return nil
        }

        let name = application.localizedName?.isEmpty == false
            ? application.localizedName ?? bundleID
            : bundleID

        return ApplicationRecord(bundleID: bundleID, name: name)
    }

    private static func runningApplication(
        from notification: Notification
    ) -> NSRunningApplication? {
        notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
    }
}

private enum Command {
    case current
    case list
    case observe
    case activate(String)

    static func parse(_ arguments: [String]) throws -> Command {
        if arguments == ["--current"] {
            return .current
        }
        if arguments == ["--list"] {
            return .list
        }
        if arguments == ["--observe"] {
            return .observe
        }
        if arguments.count == 2, arguments[0] == "--activate" {
            let bundleID = arguments[1].trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
            guard !bundleID.isEmpty else {
                throw ActivityError(
                    operation: "parse",
                    code: "invalid-command",
                    message: "Usage: --current, --list, --observe, or --activate <bundleId>."
                )
            }
            return .activate(bundleID)
        }

        throw ActivityError(
            operation: "parse",
            code: "invalid-command",
            message: "Usage: --current, --list, --observe, or --activate <bundleId>."
        )
    }
}

private struct ApplicationRecord {
    let bundleID: String
    let name: String
}

private struct ActivityEvent: Encodable {
    let protocolVersion: Int
    let type: String
    let event: String?
    let operation: String?
    let bundleId: String?
    let name: String?
    let success: Bool?
    let count: Int?
    let code: String?
    let message: String?

    static var ready: ActivityEvent {
        ActivityEvent(
            protocolVersion: activityProtocolVersion,
            type: "ready",
            event: nil,
            operation: "observe",
            bundleId: nil,
            name: nil,
            success: true,
            count: nil,
            code: nil,
            message: nil
        )
    }

    static func current(_ application: ApplicationRecord) -> ActivityEvent {
        applicationEvent(type: "current", application: application)
    }

    static func application(_ application: ApplicationRecord) -> ActivityEvent {
        applicationEvent(type: "application", application: application)
    }

    static func activation(
        application: ApplicationRecord,
        success: Bool,
        operation: String = "observe",
        code: String? = nil,
        message: String? = nil
    ) -> ActivityEvent {
        ActivityEvent(
            protocolVersion: activityProtocolVersion,
            type: "activation",
            event: nil,
            operation: operation,
            bundleId: application.bundleID,
            name: application.name,
            success: success,
            count: nil,
            code: code,
            message: message
        )
    }

    static func termination(_ application: ApplicationRecord) -> ActivityEvent {
        ActivityEvent(
            protocolVersion: activityProtocolVersion,
            type: "termination",
            event: nil,
            operation: "observe",
            bundleId: application.bundleID,
            name: application.name,
            success: nil,
            count: nil,
            code: nil,
            message: nil
        )
    }

    static func lifecycle(event: String) -> ActivityEvent {
        ActivityEvent(
            protocolVersion: activityProtocolVersion,
            type: "lifecycle",
            event: event,
            operation: "observe",
            bundleId: nil,
            name: nil,
            success: nil,
            count: nil,
            code: nil,
            message: nil
        )
    }

    static func complete(operation: String, count: Int) -> ActivityEvent {
        ActivityEvent(
            protocolVersion: activityProtocolVersion,
            type: "complete",
            event: nil,
            operation: operation,
            bundleId: nil,
            name: nil,
            success: true,
            count: count,
            code: nil,
            message: nil
        )
    }

    static func error(
        operation: String,
        code: String,
        message: String,
        bundleID: String? = nil
    ) -> ActivityEvent {
        ActivityEvent(
            protocolVersion: activityProtocolVersion,
            type: "error",
            event: nil,
            operation: operation,
            bundleId: bundleID,
            name: nil,
            success: false,
            count: nil,
            code: code,
            message: message
        )
    }

    private static func applicationEvent(
        type: String,
        application: ApplicationRecord
    ) -> ActivityEvent {
        ActivityEvent(
            protocolVersion: activityProtocolVersion,
            type: type,
            event: nil,
            operation: nil,
            bundleId: application.bundleID,
            name: application.name,
            success: nil,
            count: nil,
            code: nil,
            message: nil
        )
    }
}

private final class EventWriter: @unchecked Sendable {
    private let output = FileHandle.standardOutput
    private let errorOutput = FileHandle.standardError
    private let lock = NSLock()
    private let encoder = JSONEncoder()
    private var hasFailed = false

    func emit(_ event: ActivityEvent) {
        lock.lock()
        defer { lock.unlock() }

        guard !hasFailed else { return }

        do {
            var data = try encoder.encode(event)
            data.append(0x0A)
            try output.write(contentsOf: data)
        } catch {
            hasFailed = true
            let message = "Focus Familiar activity output failed.\n"
            try? errorOutput.write(contentsOf: Data(message.utf8))
        }
    }
}

private struct ActivityError: Error {
    let operation: String
    let code: String
    let message: String
    let bundleID: String?
    let exitCode: Int32

    init(
        operation: String,
        code: String,
        message: String,
        bundleID: String? = nil,
        exitCode: Int32 = EXIT_FAILURE
    ) {
        self.operation = operation
        self.code = code
        self.message = message
        self.bundleID = bundleID
        self.exitCode = exitCode
    }
}
