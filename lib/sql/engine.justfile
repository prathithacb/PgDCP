interpolateShebangContent := "../interpolate-shebang-content.pl"
supplyRecipeJustFile := "../recipe-suppliers.justfile"

_pg-dcp-recipe +ARGS:
    @just -f {{supplyRecipeJustFile}} {{ARGS}}

psql-init-engine-instance:
    #!/usr/bin/env {{interpolateShebangContent}}
    CREATE EXTENSION IF NOT EXISTS pgtap;
    CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
    CREATE SCHEMA IF NOT EXISTS :dcp_schema_assurance;

psql-assurance-engine-version expectMinVersion testFnName="test_engine_version":
    #!/usr/bin/env {{interpolateShebangContent}}
    CREATE OR REPLACE FUNCTION :dcp_schema_assurance.{{testFnName}}() RETURNS SETOF TEXT LANGUAGE plpgsql AS $$
    BEGIN 
        RETURN NEXT ok(pg_version_num() > {{expectMinVersion}}, 
                       format('PostgreSQL engine instance versions should be at least {{expectMinVersion}} [%s]', pg_version()));
    END;
    $$;
