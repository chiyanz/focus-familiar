export interface ApplicationIdentity {
  readonly bundleId: string;
  readonly name: string;
}

export interface PlatformError {
  readonly code: string;
  readonly message: string;
}

export type PlatformResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PlatformError };

export type ApplicationActivityEvent =
  | {
      readonly type: "application-activated";
      readonly atMs: number;
      readonly application: ApplicationIdentity;
    }
  | {
      readonly type: "application-terminated";
      readonly atMs: number;
      readonly application: ApplicationIdentity;
    }
  | { readonly type: "system-sleep"; readonly atMs: number }
  | { readonly type: "system-wake"; readonly atMs: number }
  | {
      readonly type: "observation-error";
      readonly atMs: number;
      readonly error: PlatformError;
    };

export interface Disposable {
  dispose(): void;
}

export interface ActivityProvider {
  currentApplication(): Promise<PlatformResult<ApplicationIdentity>>;
  listApplications(): Promise<PlatformResult<readonly ApplicationIdentity[]>>;
  observe(listener: (event: ApplicationActivityEvent) => void): Disposable;
}

export interface ApplicationActivator {
  activate(bundleId: string): Promise<PlatformResult<ApplicationIdentity>>;
}

export interface Clock {
  nowMs(): number;
}
