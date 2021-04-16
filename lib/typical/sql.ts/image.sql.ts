import * as SQLa from "../../mod.ts";
import { schemas } from "../mod.ts";

export const affinityGroup = new schemas.TypicalAffinityGroup("image");

export function SQL(
  ctx: SQLa.DcpInterpolationContext,
  options?: SQLa.InterpolationContextStateOptions,
): SQLa.DcpInterpolationResult {
  const state = ctx.prepareState(
    ctx.prepareTsModuleExecution(import.meta.url),
    options ||
      {
        schema: schemas.lib,
        affinityGroup,
        extensions: [schemas.pgCatalog.plPythonExtn],
      },
  );
  const [sQR] = state.observableQR(state.schema);
  const { lcFunctions: fn } = state.affinityGroup;

  // deno-fmt-ignore
  return SQLa.SQL(ctx, state)`
    -- TODO: perform pip install or upgrade of required packages via an anonymous code block
    -- DO $$
    -- import pip3
    -- pip3.main(["install", "--user", "pillow"])
    -- $$ LANGUAGE plpython3u;

    CREATE OR REPLACE PROCEDURE safe_create_image_meta_data_type() AS $$
    BEGIN
        CREATE TYPE ${sQR("image_meta_data")} AS (
            provenance TEXT,
            image_format TEXT,
            image_width INTEGER,
            image_height INTEGER,
            image_size_bytes INTEGER,
            image_is_valid BOOLEAN,
            image_status_msg TEXT
        );
        CREATE TYPE ${sQR("image_content")} AS (
            provenance TEXT,
            image bytea,
            image_format TEXT,
            image_width INTEGER,
            image_height INTEGER,
            image_size_bytes INTEGER,
            image_format_original TEXT,
            image_size_original INTEGER,
            image_width_original INTEGER,
            image_height_original INTEGER,
            image_file_extension_original TEXT,
            image_hash TEXT, -- TODO: create proper domain
            is_transformed BOOLEAN,
            image_is_valid BOOLEAN,
            image_file_extension TEXT,
            image_status_msg TEXT
        );
    EXCEPTION
        WHEN DUPLICATE_OBJECT THEN
            RAISE NOTICE 'type "image_meta_data" already exists, skipping';
    END;
    $$ LANGUAGE PLPGSQL;

    -- TODO: separate constructIdempotent into constructStorage/constructIdempotent
    -- TODO: separate destroyIdempotent into destroyStorage/destroyIdempotent
    CREATE OR REPLACE PROCEDURE ${fn.constructIdempotent(state).qName}() AS $$
    BEGIN
        CALL safe_create_image_meta_data_type();
        
        CREATE OR REPLACE FUNCTION ${sQR("inspect_image_meta_data")}(provenance text, image bytea) RETURNS ${sQR("image_meta_data")} AS $innerFn$
        from io import BytesIO
        import PIL
        from PIL import Image
        try:
            mem_file = BytesIO()
            mem_file.write(image)
            img = Image.open(mem_file)
            img.verify()
            format = img.format
            width, height = img.size
            sizeBytes = mem_file.getbuffer().nbytes
            img.close()
            return provenance, format, width, height, sizeBytes, True, repr(img)
        except Exception as error:
            return provenance, "unknown", -1, -1, -1, False, repr(error)
        $innerFn$ LANGUAGE plpython3u;
        comment on function ${sQR("inspect_image_meta_data")}(provenance text, image bytea) is 'Given a binary image, detect its format and size';
        
        CREATE OR REPLACE FUNCTION ${sQR("optimize_image")}(provenance text,original_image bytea, optimize_size integer) RETURNS ${sQR("image_content")} AS $innerFn$
        from io import BytesIO
        import PIL
        from PIL import Image
        import math
        import imagehash
        try:
            optimized_image = original_image
            mem_file = BytesIO()
            mem_file.write(original_image)
            img = Image.open(mem_file)
            image_hash = imagehash.average_hash(img)
            img.verify()
            image_format_original = img.format
            image_file_extension_original = '.'+image_format_original.lower()
            image_width_original, image_height_original = img.size
            image_size_original = mem_file.getbuffer().nbytes
            allowed_images = ['PNG', 'JPEG', 'JPG', 'jpg','png','jpeg']
            is_transformed = False
            if image_size_original > optimize_size and image_format_original in allowed_images:
                is_transformed = True
                rgb_im = Image.open(mem_file).convert("RGB")
                Qmin, Qmax = 25, 96
                Qacc = -1
                while Qmin <= Qmax:
                    m = math.floor((Qmin + Qmax) / 2)
                    buffer = io.BytesIO()
                    rgb_im.save(buffer, format="JPEG", quality=m)
                    s = buffer.getbuffer().nbytes
                    if s <= optimize_size:
                        Qacc = m
                        Qmin = m + 1
                    elif s > optimize_size:
                        Qmax = m - 1
                image_format = 'JPEG'
                image_file_extension = '.jpeg'
                buffer = io.BytesIO()
                if Qacc > -1:
                    rgb_im.save(buffer, format="JPEG", quality=Qacc)
                else:
                    rgb_im.save(buffer, format="JPEG", quality=50)
                size_bytes = buffer.getbuffer().nbytes
                optimized_image = buffer.getvalue()
            else:
                size_bytes = image_size_original
                image_format = image_format_original
                image_file_extension = image_file_extension_original
            img.close()
            return provenance,optimized_image,image_format,image_width_original,image_height_original,size_bytes,image_format_original, image_size_original,image_width_original, image_height_original,image_file_extension_original,image_hash,is_transformed,True,image_file_extension,repr(img)
        except Exception as error:
            return provenance,original_image,"unknown",-1,-1,-1,"unknown",-1,-1,-1,"unknown","unknown",False,False,"unknown",repr(error)
        $innerFn$ LANGUAGE plpython3u;
        comment on function ${sQR("optimize_image")}(provenance text,original_image bytea, optimize_size integer) is 'Given a  compressed binary image, detect its format and size';

        CREATE OR REPLACE FUNCTION ${fn.unitTest(state).qName}() RETURNS SETOF TEXT LANGUAGE plpgsql AS $unitTestFn$
        DECLARE
            imgMD ${sQR("image_meta_data")};
        BEGIN 
            RETURN NEXT has_extension('plpython3u');
            RETURN NEXT has_type('image_meta_data');
            RETURN NEXT has_function('inspect_image_meta_data');

            -- The test values were obtained by using BBeaver "advanced copy" functionality from miniflux.icons table
            -- This is a 32x32 PNG file
            imgMD := ${sQR("inspect_image_meta_data")}('bytea://test1valid', decode('89504E470D0A1A0A0000000D494844520000002000000020080300000044A48AC600000300504C544547704C7A3F17CC6527070301B14D1F291716D2722909111C000000070609CE7127172A441531591A2F51CD6923000000CD6B28B34B1F652F0E7430147B431890491BDA7B28572C111B355AC66A27773816AF6124C4682706000D182E51273D60CD6426A5531BC26525192F51283F61A1571E20385C182942112A4F112E578342051F375CDA7A2B3A1709C15F24C15623BE6426C26828CF6727A85D23A74A1E953F1AD25D27B54C20944D1DAD481ED26629C75D2598441DD1752BC67029783413913C199E491EE47D2EC6722ADA7A2EB85522CF6929E481302F1909CE6828C0722EDA7E2EC7722ADD7C2EEE8D33152B4C5C4B40F19135A060222A4063CB6727E0832EF78F2D554A49152E551C345A5B2B0FD3702A10315E162F55A95D22284267112A50EB8B327A3F18DB7923192D4A904D1D8B4A1CB85A19A6521FC76928152E53C871277D53303838442134529C68421210152A3953E2802FA55921B3572112294980411920365827272FC36324DB6D2ABC5B2376502FB5581D74442320293A223F671C32544B4140FFFFFFEB7D2FE97B2EED8331FA9A37FA9C371D355AE7742CE9772EEF8831F28731C7CDD7E06929E46D2AEC7F30DE6027DC6027F59334DF6329DF662AEC8131E5702BF59033355177F18A32E5742DF38E34E26B29FF9631C2C9D4213D65DD622AE7792DFF9E34FB9735DFE2E8755B4AF79434F78B30F08432FE8F303B577D4A6488FF9B30FB8B2D3F4050476185584947294166E06026FC9E37E7762EF79736FFA434E881301F3A616C7C95A8B3C3354B6C7185A0F3F5F7253959FEFEFFE8EAEE73839B163969586C894F6482B9C0CD2F46685467848997AB8D6343909DAFC9D0DAF0822D8C603D4D678A2E3F5EB1BBC92C3853DE7E30445877564E51FBFBFC14356386664AB57A43445979253C5FA5AFBEB37241CB7D3CAF7845F38830EA8833DB8A3C4446523C547893A0B2BF7539E485342D3E5B7B8BA296663C634A43A77042E9EBEFA1ABBA6D5B54E3E6EB6D839F7B4E3D8494AB96673D1D4272965537504547BA602E273E61D5DCE4647690D6DBE3BDC5D24459787F3200DC0000008374524E53001BAD08C11FAE050602C531FCFCC00EA5C7495C2024AC416696509D7813910FB63365C20D55C04CB03C0CF2CA316DD18070B6459A85F8BB64A5E5D27CA0B6128B7DF3C1C6B3D5D737AFD0EC83B2F8786EFD3CA5AAC9D4BFCBF424B652DC8B1CA0FE5DAEB674428D44A2EB8CA82B9CEB288BEF855E8931F745C9ED81AB4F9B9287DB7CB8EE82AE000002964944415438CB6360A002D0331230303466C4AD40A1ABABBBB5D5C9C5278813C495D79408E64651C0D4B56D716BCBC4B6553DA101127211917BF7DE614555D00D929FDED6B6FEDEAEDBBBCFF4ED3FAA8C6A85670B44BE67F5F235079B9B9BF79F90435510B2B875E2AA55BD0F57AEDCB00F28DFBCA0531D5541945452AA3457D18B47F73BF780143CE3AD6057915741F74BE1C59707762D032938C95BAEADBD590D5D81DAD1B30BFA40F207FB162CE8BB74220F21A52429A3A498CBF3BE19099C457647746F4FCFFAFC851F91159CE22D402860EBED99BDFAC391B5C74E1E02C91DDEB871E3DA6F9BD29114CC9E3D77E6DBD3AF373C05C9BF5BB8E9EBF9F3A79F9F934228983977EECCF9EBD63D0187C2719E9C75F3E7AF5ED9EB260B5320B0B367E68A154B1F4342E154966CF6DCD93D6D6DAD8E3005ACE249715C894B1E1C0187C2316506669DDEB6E92D2D56C851C62C2EB67C0D48FED0E6520686B49DD35B5ABBE7D8A0041467EC61B0133A6B809CCC89ADDBB6755BF3232B88E7B90B52F0E5F215550686B239DDDBE6CCE81782CB328A32C4FC023BE1C28FF53AC08415D23D67C68409265069515FBFC0B0F059D7410AD66C3A77A5A941B316283F6F823EC40E7BF7F6F68E1DCBD782C3F84CE7E58B9B7F716B55CD98D7DF6FA60B5620B31DA4E0E62C482CFCBDF4FB4F232783C284FE6953270B83158801E53B96DCBAD1078BA9FF1A0C0CD5F3A64D5D34C914ACC0B6A3A3A37DE9946BB3A02AFE2DAC676028E99FBA68F2244BB002D5295BDBB7AF98EFA5D17975F7AB4F17662DDC50C7C090316DD1E4C993CCC1398553724AFBD215DE420CDCFE09296F3E7FFF398F8F814171DAD42D93B60832838D60B7B07396F60033B592B9F8F82A8B3919185D595858041D3860E10C6330B03303013B8CC14144D606004CE532BC9652AC850000000049454E44AE426082','hex')::bytea);
            RETURN NEXT is(imgMD.provenance, 'bytea://test1valid', 'Test image 1 should have provenance');
            RETURN NEXT is(imgMD.image_is_valid, true, 'Test image 1 should be valid');
            RETURN NEXT is(imgMD.image_format, 'PNG', 'Test image 1 should be PNG format');
            RETURN NEXT is(imgMD.image_width, 32, 'Test image 1 should be 32 pixels wide');
            RETURN NEXT is(imgMD.image_height, 32, 'Test image 1 should be 32 pixels high');

            -- This is a 16x16 ICO file
            imgMD := ${sQR("inspect_image_meta_data")}('bytea://test2valid', decode('0000010001001010000001002000680400001600000028000000100000002000000001002000000000000004000000000000000000000000000000000000FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00CBBA93A3D2C5A38AFFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00C0AC7CBFC8B78DA7FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FDFDFC03F1EDE328FFFFFF00FFFFFF00C0AC7CBFC8B78DA7FFFFFF00FFFFFF00EFEADF32FEFDFD03FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00E2D9C457AC9252F6FEFEFD01FFFFFF00C0AC7CBFC8B78DA7FFFFFF00F8F5F019A98E4CFDEAE3D344FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00E0D6BE5EAA8F4FFCFDFDFC03FFFFFF00C0AC7CBFC8B78DA7FFFFFF00F6F4ED1FA98E4CFFE8E1D048FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00DFD6BE5EAA8F4FFCFDFDFC03FFFFFF00C0AC7CBFC8B78DA7FFFFFF00F6F4ED1FA98E4CFFE8E1D048FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00E0D6BE5EAA8F4FFCFDFDFC03FFFFFF00C0AC7CBFC8B78DA7FFFFFF00F6F4ED1FA98E4CFFE8E1D048FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00E0D6BE5EAA8F4FFCFDFDFC03FFFFFF00C0AC7CBFC8B78DA7FFFFFF00F6F4ED1FA98E4CFFE8E1D048FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00DFD6BE5EAA8F4FFCFDFDFC03FFFFFF00C0AC7CBFC8B78DA7FFFFFF00F6F4ED1FA98E4CFFE8E1D048FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00DFD6BE5EAA8F4FFCFDFDFC03FFFFFF00C0AC7CBFC8B78DA7FFFFFF00F6F4ED1FA98E4CFFE8E1D048FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00DFD6BE5EAA8F4FFCFDFDFC03FFFFFF00C0AC7CBFC8B78DA7FFFFFF00F6F4ED1FA98E4CFFE8E1D048FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00DFD6BE5EAA8F4FFCFDFDFC03FFFFFF00C0AC7CBFC8B78DA7FFFFFF00F6F4ED1FA98E4CFFE8E1D048FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00E2D9C457AC9252F6FEFEFD01FFFFFF00C0AC7CBFC8B78DA7FFFFFF00F8F5F019A98E4CFDEAE3D344FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FDFDFC03F1EDE328FFFFFF00FFFFFF00C0AC7CBFC8B78DA7FFFFFF00FFFFFF00EFEADF32FEFDFD03FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00C0AC7CBFC8B78DA7FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00CBBA93A3D2C5A38AFFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FFFFFF00FE7F0000FE7F0000FE7F0000F66F0000F66F0000F66F0000F66F0000F66F0000F66F0000F66F0000F66F0000F66F0000F66F0000FE7F0000FE7F0000FE7F0000','hex')::bytea);
            RETURN NEXT is(imgMD.image_is_valid, true, 'Test image 2 should be valid');
            RETURN NEXT is(imgMD.image_format, 'ICO', 'Test image 2 should be ICO format');
            RETURN NEXT is(imgMD.image_width, 16, 'Test image 2 should be 32 pixels wide');
            RETURN NEXT is(imgMD.image_height, 16, 'Test image 2 should be 32 pixels high');

            -- This is an invalid image
            imgMD := ${sQR("inspect_image_meta_data")}('bytea://test3invalid', decode('F17CC6527070301B14D1F291716D2722909111','hex')::bytea);
            RETURN NEXT is(imgMD.image_is_valid, false, 'Test image 3 should be invalid');
            RETURN NEXT is(imgMD.image_format, 'unknown', 'Test image 3 format should be unknown');
        END;
        $unitTestFn$;    END;
    $$ LANGUAGE PLPGSQL;

    CREATE OR REPLACE PROCEDURE ${fn.destroyIdempotent(state).qName}() AS $$
    BEGIN
        DROP FUNCTION IF EXISTS ${fn.unitTest(state).qName}();
        DROP FUNCTION IF EXISTS image_format_size(bytea);
        DROP TYPE IF EXISTS image_format_size_type;
    END;
    $$ LANGUAGE PLPGSQL;
`;
}
