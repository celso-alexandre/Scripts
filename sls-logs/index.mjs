import enquirer from 'enquirer';
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { program } from 'commander';
import {
  cp, mkdir, readFile, writeFile,
} from 'fs/promises';
import { processYamlFiles } from './getSlsFuncNames.mjs';

const { MultiSelect } = enquirer;

const cur = process.cwd();
const scriptDir = process.argv[1].endsWith('.mjs') ? dirname(process.argv[1]) : process.argv[1];
const knownPaths = [
  join(cur, 'serverless', 'lambdas'),
  join(cur, 'serverless', 'lambda'),
  join(cur, 'serverless', 'functions'),
  join(cur, 'serverless', 'function'),
];
const knownPatsHelp = knownPaths.map((p) => `./${p.split('/').slice(-2).join('/')}`);
console.log('script dir', scriptDir);

program
  .description('Use this to watch lambdas logs using serverless cli. All args are optional')
  .usage('[...lambdasToWatch] [flags]')
  .option('-i, --install', 'Copy this script into the current node project')
  .option('a, --slsArgs', 'Add extra args to sls command')
  .option('-l, --lambdaDir <string>', `Path to directory containing lambda definition yml files. If not specified, will look at:\n${knownPatsHelp.join(', ')}`)
  .option('-ll, --lambdaList <string...>', 'Lambda list (Overrides --lambdaDir)')
  .option('-o, --logOnce <boolean>', 'Logs just once instead of streaming', false);

program.parse();

const {
  install, slsArgs, logOnce, lambdaDir, lambdaList,
} = program.opts();
const lambdasToWatch = program.args;

async function run() {
  if (install) {
    if (!existsSync(join(cur, 'package.json'))) {
      console.error(chalk.redBright('Current directory has no package.json file'));
      process.exit(1);
    }
    const promptInstall = await enquirer.prompt({
      type: 'input',
      name: 'install',
      message: 'Are you sure you want to install this script here? (y) ',
    });
    if (promptInstall.install && promptInstall.install !== 'y') {
      console.error(chalk.redBright('Choose not to install. Exiting...'));
      process.exit(1);
    }

    const scripts = join(cur, 'scripts');
    await mkdir(scripts, { recursive: true });
    console.log('Copying slsLogs.mjs and getSlsFuncNames.mjs to scripts dir...');
    const packageJsonPath = join(scripts, '..', 'package.json');
    const [packageJson] = await Promise.all([
      readFile(packageJsonPath),
      cp(join(scriptDir, 'index.mjs'), join(scripts, 'slsLogs.mjs'), { force: true }),
      cp(join(scriptDir, 'getSlsFuncNames.mjs'), join(scripts, 'getSlsFuncNames.mjs'), { force: true }),
    ]);
    const json = JSON.parse(packageJson.toString());
    if (!json.scripts) json.scripts = {};
    json.scripts['sls:logs'] = 'node scripts/slsLogs.mjs';
    await writeFile(packageJsonPath, JSON.stringify(json, null, 2));
    console.log(chalk.greenBright('Succesfully installed'));
    console.warn(chalk.yellowBright('Run `yarn add -D enquirer commander`'));
    process.exit(0);
  }

  let lambdas = [];
  if (!lambdasToWatch?.length) {
    if (lambdaList?.length) {
      lambdas = lambdaList;
    } else if (lambdaDir) {
      if (!existsSync(lambdaDir)) {
        console.error(`${chalk.redBright('Specified directory do not exists:')} ${lambdaDir}`);
        process.exit(1);
      }
      lambdas = processYamlFiles(lambdaDir);
      if (lambdas.length) {
        console.error(`${chalk.redBright('Found no lambdas at:')} ${lambdaDir}`);
        process.exit(1);
      }
    } else {
      knownPaths.forEach((pat) => {
        try {
          if (lambdas.length) return;
          if (existsSync(pat)) {
            lambdas = processYamlFiles(pat);
          }
        } catch (err) {
          console.error(err);
        }
      });

      if (!lambdas.length) {
        console.error(chalk.redBright('Could not find any lambdas'));
        console.warn(`${chalk.yellow('Looked at:')}\n${knownPaths.join('\n')}`);
        process.exit(1);
      }
    }
  }

  const promptLambdas = new MultiSelect({
    type: '',
    name: 'lambdas',
    message: 'Select lambdas to watch',
    choices: lambdas,
  });
  let selectedLambdas = lambdasToWatch;
  if (!selectedLambdas?.length) {
    selectedLambdas = await promptLambdas.run();
  }

  console.log('');

  selectedLambdas.forEach((fn) => {
    const liveLogs = spawn('sh', ['-c', `yarn sls logs ${logOnce ? '' : '-t '}-f ${fn}${slsArgs ? ` ${slsArgs}` : ''}`]);

    liveLogs.stdout.on('data', (data) => {
      let txt = data.toString();
      if (txt.toLowerCase().includes('error')) txt = chalk.red(txt);
      console.log(chalk.green(fn), `stdout: ${txt}`);
    });

    liveLogs.stderr.on('data', (data) => {
      console.error(chalk.red(fn), `stderr: ${data.toString()}`);
    });

    liveLogs.on('exit', (code) => {
      const consoleType = code === 0 ? 'log' : 'error';
      let txt = `${fn} child process exited with code ${code.toString()}`;
      if (consoleType === 'error') txt = chalk.red(txt);
      else txt = chalk.green(txt);
      console[consoleType](txt);
      console.log('');
    });
  });
}

run().then();
