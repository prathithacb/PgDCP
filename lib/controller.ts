import {
  colors,
  docopt,
  fmt,
  fs,
  govnSvcVersion as gsv,
  path,
  safety,
  textWhitespace as tw,
  uuid,
} from "./deps.ts";
import * as interp from "./interpolate.ts";
import * as context from "./context.ts";

export interface ExecutionContext {
  readonly calledFromMetaURL: string;
  readonly version?: string;
  readonly projectHome?: string;
}

export interface CliExecutionContext extends ExecutionContext {
  readonly cliArgs: docopt.DocOptions;
}

export const isCliExecutionContext = safety.typeGuard<CliExecutionContext>(
  "cliArgs",
);

export interface InteropolateOptions {
  readonly destHome?: string;
}

export interface ControllerOptions {
  readonly projectHome: string;
  readonly transactionID: string;
  readonly isVerbose: boolean;
  readonly isDryRun: boolean;
  readonly buildHostID: string;

  readonly interpolate: () => InteropolateOptions;
  readonly mkDirs: (dirs: string) => void;
}

export function cliControllerOptions(
  ec: CliExecutionContext,
): ControllerOptions {
  const {
    "--project": projectArg,
    "--verbose": verboseArg,
    "--dry-run": dryRunArg,
    "--tx-id": transactionIdArg,
  } = ec.cliArgs;
  const projectHomeDefault = projectArg
    ? projectArg as string
    : (ec.projectHome || Deno.cwd());
  const projectHomeRel = path.isAbsolute(projectHomeDefault)
    ? path.relative(Deno.cwd(), projectHomeDefault)
    : projectHomeDefault;
  const projectHomeAbs = path.resolve(Deno.cwd(), projectHomeRel);
  const isDryRun = dryRunArg ? true : false;
  const isVerbose = isDryRun || (verboseArg ? true : false);
  const transactionID = transactionIdArg
    ? transactionIdArg.toString()
    : uuid.v4.generate();

  const ctlOptions: ControllerOptions = {
    projectHome: projectHomeAbs,
    transactionID,
    isDryRun,
    isVerbose,
    buildHostID: Deno.hostname(),
    mkDirs: (dirs: string) => {
      if (!fs.existsSync(dirs)) {
        if (isVerbose || isDryRun) {
          console.log(`mkdir -p ${colors.yellow(dirs)}`);
        }
        if (!isDryRun) {
          Deno.mkdirSync(dirs, { recursive: true });
        }
      }
    },
    interpolate: () => {
      const { "--dest": destHome } = ec.cliArgs;
      const interpOptions: InteropolateOptions = {
        destHome: destHome ? destHome as string : undefined,
      };
      if (interpOptions.destHome) ctlOptions.mkDirs(interpOptions.destHome);
      return interpOptions;
    },
  };
  return ctlOptions;
}

export class ControllerInterpolationEngine
  implements interp.InterpolationEngine<context.InterpolationContext> {
  #executionIndex = 0;

  constructor(
    readonly version: string,
    readonly ctlOptions: ControllerOptions,
    readonly interpOptions: InteropolateOptions,
    readonly ctx = context.typicalInterpolationContext(),
  ) {
  }

  prepareIdentity(p: interp.TemplateProvenance) {
    return {
      index: ++this.#executionIndex,
      stamp: new Date(),
    };
  }

  onSuccessfulInterpolation(
    result: interp.InterpolationResult<
      context.InterpolationContext,
      interp.TemplateProvenance
    >,
  ) {
    if (this.interpOptions.destHome) {
      let srcFileName = result.state.provenance.importMetaURL.split("/").pop();
      if (srcFileName) {
        // remove all extensions
        srcFileName = srcFileName.replace(/\..+$/, "");
      }
      const fileName = fmt.sprintf(
        path.join(this.interpOptions.destHome, "%03d_%s.auto.sql"),
        result.state.execID.index,
        srcFileName,
      );
      if (this.ctlOptions.isVerbose || this.ctlOptions.isDryRun) {
        console.log(colors.yellow(fileName));
      }
      if (!this.ctlOptions.isDryRun) {
        Deno.writeTextFileSync(fileName, result.interpolated);
      }
    } else {
      console.log(result.interpolated);
    }
  }
}

export abstract class Controller {
  constructor(
    readonly ec: ExecutionContext,
    readonly options: ControllerOptions,
  ) {
  }

  async initController(): Promise<void> {
  }

  async finalizeController(): Promise<void> {
  }

  async interpolationEngine(
    interpOptions: InteropolateOptions,
  ): Promise<ControllerInterpolationEngine> {
    return new ControllerInterpolationEngine(
      await this.determineVersion(),
      this.options,
      interpOptions,
    );
  }

  abstract interpolate(interpOptions: InteropolateOptions): Promise<void>;

  async handleCLI(): Promise<boolean> {
    if (!isCliExecutionContext(this.ec)) {
      throw Error("Expecting CLI execution environment");
    }
    const { cliArgs } = this.ec;

    const { "interpolate": interpolate } = cliArgs;
    if (interpolate) {
      await this.interpolate(this.options.interpolate());
      return true;
    }

    const { "version": version } = cliArgs;
    if (version) {
      console.log(
        `PgDCP Controller ${
          colors.yellow(await this.determineVersion(import.meta.url))
        }`,
      );
      return true;
    }

    return false;
  }

  async determineVersion(
    importMetaURL: string = import.meta.url,
  ): Promise<string> {
    return this.ec.version || await gsv.determineVersionFromRepoTag(
      importMetaURL,
      { repoIdentity: importMetaURL.split("/").pop() },
    );
  }
}

export function cliArgs(caller: ExecutionContext): CliExecutionContext {
  const docOptSpec = tw.unindentWhitespace(`
    PgDCP Controller ${caller.version}.

    Usage:
    dcpctl interpolate [--dest=<dest-home>] [--log=<log-file>] [--dry-run] [--verbose]
    dcpctl version
    dcpctl -h | --help

    Options:
    <dest-home>         Path where destination file(s) should be stored (STDOUT otherwise)
    --dry-run           Show what will be done (but don't actually do it) [default: false]
    --verbose           Be explicit about what's going on [default: false]
    -h --help           Show this screen
  `);
  return {
    ...caller,
    cliArgs: docopt.default(docOptSpec),
  };
}

export async function CLI(ctl: Controller): Promise<void> {
  try {
    await ctl.initController();
    if (!ctl.handleCLI()) {
      console.error("Unable to handle validly parsed docoptSpec:");
      console.dir(cliArgs);
    }
    await ctl.finalizeController();
  } catch (e) {
    console.error(e.message);
  }
}

// if (import.meta.main) {
//   dotenv.config({ safe: true, export: true });
//   const cliEC = cliArgs({
//     calledFromMetaURL: import.meta.url,
//   });
//   await CLI(new Controller(cliEC, cliControllerOptions(cliEC)));
// }
