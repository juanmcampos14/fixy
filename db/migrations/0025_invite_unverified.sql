-- Los clientes pueden pedirle trabajo a profesionales que todavía no se verificaron (alta en curso o en revisión):
-- reciben la invitación, pero deben verificarse para aceptarla. Un TRABAJO sigue exigiendo profesional aprobado
-- (trigger jobs_provider_active). Rechazados y suspendidos no reciben invitaciones.
CREATE FUNCTION app.check_invitation_provider() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM providers WHERE id = NEW.provider_id;
  IF st IS NULL OR st NOT IN ('pending','in_review','approved') THEN
    RAISE EXCEPTION 'provider_not_eligible: estado %', st USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER invitations_provider_active ON request_invitations;
CREATE TRIGGER invitations_provider_active BEFORE INSERT ON request_invitations
  FOR EACH ROW EXECUTE FUNCTION app.check_invitation_provider();

INSERT INTO platform_settings (key, value) VALUES ('booking.respond_hours_unverified', '48'::jsonb) ON CONFLICT (key) DO NOTHING;
