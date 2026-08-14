-- Final RBAC model: ADMIN / PARENT / CHILD only.
-- Migration 0003 already restricts new rows to these roles. This migration
-- safely normalizes any FAMILY_ADMIN rows that may have been created during development.
UPDATE app_users SET global_role='PARENT', updated_at=CURRENT_TIMESTAMP WHERE global_role='FAMILY_ADMIN';
