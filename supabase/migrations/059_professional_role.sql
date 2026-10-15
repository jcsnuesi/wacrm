-- Separate migration: commit the enum value before migration 060 uses it.
ALTER TYPE public.account_role_enum ADD VALUE IF NOT EXISTS 'professional';
