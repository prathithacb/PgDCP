contentCsvFileName := "IETF-RFC6838-media-types.content.csv"
supplyRecipeJustFile := "../../recipe-suppliers.justfile"
emitRecipeCmd := "../../emit-recipe-content.pl"

_pg-dcp-recipe +ARGS:
    @just -f {{supplyRecipeJustFile}} {{ARGS}}

# Generate psql SQL snippets to create common image management functions
psql-construct-immutable-functions:
    @cat image-manager.sql

# Generate psql SQL snippets to drop common image management functions
psql-destroy-immutable-functions:
    #!/usr/bin/env {{emitRecipeCmd}}
    DROP FUNCTION IF EXISTS :schema_assurance.test_image_management();
    DROP FUNCTION IF EXISTS image_format_size(bytea);

# Generate complete psql SQL to create all image management library of objects
psql-construct: psql-construct-immutable-functions

# Generate complete psql SQL to drop  all image management library of objects
psql-destroy mediaTypeTableName: psql-destroy-immutable-functions