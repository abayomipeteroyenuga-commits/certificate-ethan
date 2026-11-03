-- ETHAN CERTIFICATE v1.1.1 security hardening
-- Apply after 001_global_credential_readiness.sql when the earlier v1.1.0
-- migration has already been applied. These helpers are invoked internally
-- by SECURITY DEFINER RPCs and do not need direct browser/API execution.
begin;
revoke execute on function public.is_staff() from authenticated;
revoke execute on function public.can_manage_certificates() from authenticated;
commit;
