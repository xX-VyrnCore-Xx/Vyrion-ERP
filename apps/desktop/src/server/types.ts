/** Shapes of the server's administration API (see backend/app/schemas). */
export interface Permission {
  key: string;
  module: string;
  resource: string;
  action: string;
  description: string;
}
export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  is_system: boolean;
}
export interface Role extends RoleSummary {
  version: number;
  description: string;
  permissions: Permission[];
}
export interface ServerUser {
  id: string;
  version: number;
  email: string;
  full_name: string;
  is_active: boolean;
  has_password: boolean;
  totp_enabled: boolean;
  locked_until: string | null;
  last_login_at: string | null;
  roles: RoleSummary[];
  direct_permissions: Permission[];
  created_at: string;
  updated_at: string;
}
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}
export interface Invitation {
  user: ServerUser;
  setup_token: string;
  expires_at: string;
}
export interface SetupToken {
  setup_token: string;
  expires_at: string;
}
export interface AuditEntry {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  changes: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
}
export interface ServerSession {
  id: string;
  created_at: string;
  last_used_at: string;
  ip_address: string | null;
  user_agent: string | null;
  mfa_verified: boolean;
  current: boolean;
}
export interface LoginEvent {
  id: string;
  occurred_at: string;
  success: boolean;
  failure_reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
}
export interface Me {
  user: ServerUser;
  permissions: string[];
  session_id: string;
  mfa_verified: boolean;
}
export interface ServerCompany {
  id: string;
  version: number;
  legal_name: string;
  legal_form: string;
  tax_regime: string;
  fatturapa_regime_code: string;
  vat_number: string;
  fiscal_code: string;
  street: string;
  postal_code: string;
  city: string;
  province: string;
  country_code: string;
}
