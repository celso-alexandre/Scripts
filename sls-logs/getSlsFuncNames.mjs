import fs from 'fs';

function extractLambdaAndFunctionNames(yamlContent) {
  const lines = yamlContent.split('\n');
  const lambdaName = lines[0].replace(/:$/, '');
  return lambdaName;
}

function processYamlFile(filepath) {
  const yamlContent = fs.readFileSync(filepath, 'utf8');
  return extractLambdaAndFunctionNames(yamlContent);
}

export function processYamlFiles(dir) {
  const files = fs.readdirSync(dir);
  return files.flatMap((file) => {
    const filepath = `${dir}/${file}`;
    if (fs.statSync(filepath).isDirectory()) {
      return processYamlFiles(filepath);
    } if (file.endsWith('.yml')) {
      return [processYamlFile(filepath)];
    }
    return [];
  });
}
