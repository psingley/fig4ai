import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Starting Claude API test...');

const testProcess = spawn('node', [join(__dirname, 'src/utils/claude-test.js')], {
    stdio: 'inherit',
    env: process.env
});

testProcess.on('close', (code) => {
    console.log(`Test completed with exit code ${code}`);
    process.exit(code);
}); 