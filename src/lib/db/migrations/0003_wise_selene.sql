CREATE OR REPLACE FUNCTION public.request_claims_json()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

CREATE OR REPLACE FUNCTION public.request_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(public.request_claims_json() ->> 'role', '');
$$;

CREATE OR REPLACE FUNCTION public.request_org_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(public.request_claims_json() ->> 'org_id', ''),
    NULLIF(public.request_claims_json() ->> 'organization_id', ''),
    NULLIF(public.request_claims_json() ->> 'orgId', ''),
    NULLIF(public.request_claims_json() #>> '{app_metadata,org_id}', ''),
    NULLIF(public.request_claims_json() #>> '{app_metadata,organization_id}', '')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_authenticated_request()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.request_role() = 'authenticated';
$$;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_org_isolation ON public.organizations;
CREATE POLICY organizations_org_isolation
ON public.organizations
FOR ALL
TO PUBLIC
USING (
  public.is_authenticated_request()
  AND id = public.request_org_id()
)
WITH CHECK (
  public.is_authenticated_request()
  AND id = public.request_org_id()
);

DROP POLICY IF EXISTS jobs_org_isolation ON public.jobs;
CREATE POLICY jobs_org_isolation
ON public.jobs
FOR ALL
TO PUBLIC
USING (
  public.is_authenticated_request()
  AND organization_id IS NOT NULL
  AND organization_id = public.request_org_id()
)
WITH CHECK (
  public.is_authenticated_request()
  AND organization_id IS NOT NULL
  AND organization_id = public.request_org_id()
);

DROP POLICY IF EXISTS candidates_org_isolation ON public.candidates;
CREATE POLICY candidates_org_isolation
ON public.candidates
FOR ALL
TO PUBLIC
USING (
  public.is_authenticated_request()
  AND organization_id IS NOT NULL
  AND organization_id = public.request_org_id()
)
WITH CHECK (
  public.is_authenticated_request()
  AND organization_id IS NOT NULL
  AND organization_id = public.request_org_id()
);

DROP POLICY IF EXISTS applications_org_isolation ON public.applications;
CREATE POLICY applications_org_isolation
ON public.applications
FOR ALL
TO PUBLIC
USING (
  public.is_authenticated_request()
  AND EXISTS (
    SELECT 1
    FROM public.jobs
    WHERE public.jobs.id = applications.job_id
      AND public.jobs.organization_id = public.request_org_id()
  )
)
WITH CHECK (
  public.is_authenticated_request()
  AND EXISTS (
    SELECT 1
    FROM public.jobs
    WHERE public.jobs.id = applications.job_id
      AND public.jobs.organization_id = public.request_org_id()
  )
);

DROP POLICY IF EXISTS interviews_org_isolation ON public.interviews;
CREATE POLICY interviews_org_isolation
ON public.interviews
FOR ALL
TO PUBLIC
USING (
  public.is_authenticated_request()
  AND organization_id IS NOT NULL
  AND organization_id = public.request_org_id()
)
WITH CHECK (
  public.is_authenticated_request()
  AND organization_id IS NOT NULL
  AND organization_id = public.request_org_id()
);

DROP POLICY IF EXISTS templates_org_isolation ON public.templates;
CREATE POLICY templates_org_isolation
ON public.templates
FOR ALL
TO PUBLIC
USING (
  public.is_authenticated_request()
  AND organization_id IS NOT NULL
  AND organization_id = public.request_org_id()
)
WITH CHECK (
  public.is_authenticated_request()
  AND organization_id IS NOT NULL
  AND organization_id = public.request_org_id()
);

DROP POLICY IF EXISTS offers_org_isolation ON public.offers;
CREATE POLICY offers_org_isolation
ON public.offers
FOR ALL
TO PUBLIC
USING (
  public.is_authenticated_request()
  AND organization_id IS NOT NULL
  AND organization_id = public.request_org_id()
)
WITH CHECK (
  public.is_authenticated_request()
  AND organization_id IS NOT NULL
  AND organization_id = public.request_org_id()
);

DROP POLICY IF EXISTS audit_logs_org_isolation ON public.audit_logs;
CREATE POLICY audit_logs_org_isolation
ON public.audit_logs
FOR ALL
TO PUBLIC
USING (
  public.is_authenticated_request()
  AND organization_id IS NOT NULL
  AND organization_id = public.request_org_id()
)
WITH CHECK (
  public.is_authenticated_request()
  AND organization_id IS NOT NULL
  AND organization_id = public.request_org_id()
);
