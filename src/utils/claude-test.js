import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '..', '.env');
console.log('Loading .env from:', envPath);
dotenv.config({ path: envPath });

// Debug: Check if API key is loaded
console.log('API Key loaded:', process.env.CLAUDE_API_KEY ? 'Yes' : 'No');
if (!process.env.CLAUDE_API_KEY) {
    throw new Error('CLAUDE_API_KEY not found in environment variables');
}

async function testClaude() {
    try {
        // Initialize client
        const client = new Anthropic({
            apiKey: process.env.CLAUDE_API_KEY
        });

        // Test 1: Basic message
        console.log('Testing basic message...');
        const basicResponse = await client.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 4096,
            messages: [{ role: 'user', content: 'Say hello' }],
            temperature: 0.7
        });
        console.log('Basic response:', basicResponse.content);

        // Test 2: Tool usage
        console.log('\nTesting tool usage...');
        const toolResponse = await client.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 4096,
            temperature: 0.7,
            messages: [{ 
                role: 'user', 
                content: 'Please use the test tool to say hello' 
            }],
            tools: [{
                name: 'test_tool',
                description: 'A test tool that returns a greeting',
                input_schema: {
                    type: 'object',
                    properties: {
                        message: {
                            type: 'string',
                            description: 'The greeting message'
                        }
                    },
                    required: ['message']
                }
            }]
        });
        console.log('Tool response:', toolResponse.content);

    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
    }
}

testClaude().catch(console.error); 