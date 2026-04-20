export type SandboxFsMode = "workspace-write";
export type SandboxNetworkMode = "off" | "on";
export type SandboxDecisionMode = "sandboxed" | "unsandboxed";
export type ApprovalScope = "once" | "session" | "always";
export type SandboxApprovalMode = "ask" | "always" | "deny";

export interface SandboxPolicyInput {
  platform: NodeJS.Platform;
  cwd: string;
  workspaceRoot: string;
  fsMode: SandboxFsMode;
  networkMode: SandboxNetworkMode;
}

export interface SandboxCapability {
  supported: boolean;
  reason?: string;
}

export interface SandboxDecision {
  mode: SandboxDecisionMode;
  requiresApproval: boolean;
  reason?: string;
  policyFingerprint: string;
  fsMode: SandboxFsMode;
  networkMode: SandboxNetworkMode;
}

export interface ApprovalRequest {
  reason: string;
  command: string;
  args: string[];
  cwd: string;
  policyFingerprint: string;
}

export interface ApprovalResult {
  approved: boolean;
  scope?: ApprovalScope;
}

export interface ApprovalStore {
  getApprovedScope(key: string): ApprovalScope | undefined;
  setApprovedScope(key: string, scope: "session" | "always"): Promise<void>;
}

export interface SandboxRuntimeOptions {
  enabled: boolean;
  workspaceRoot: string;
  networkMode: SandboxNetworkMode;
  approvalMode?: SandboxApprovalMode;
  approvalResolver?: (request: ApprovalRequest) => Promise<ApprovalResult>;
  approvalStore?: ApprovalStore;
}
