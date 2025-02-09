import Anthropic from '@anthropic-ai/sdk';

export class ClaudeClient {
    constructor(apiKey) {
        this.client = new Anthropic({
            apiKey: apiKey
        });
    }

    async chat(messages, functions, functionCall) {
        try {
            console.log('DEBUG: Calling Claude API with functions:', functions ? functions.length : 'none');
            
            // Convert functions to Claude tools format - using exact format from docs
            const tools = functions ? functions.map(fn => ({
                name: fn.name,
                description: fn.description,
                input_schema: fn.input_schema
            })) : undefined;

            console.log('DEBUG: Converted to tools format:', tools);

            const response = await this.client.messages.create({
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 4096,
                temperature: 0.7,
                messages: messages.map(msg => ({
                    role: msg.role === 'user' ? 'user' : 'assistant',
                    content: msg.content
                })),
                ...(tools && { tools }),
                tool_choice: tools ? { type: 'auto' } : undefined
            });

            console.log('DEBUG: Claude API response:', response.content);

            if (functions) {
                // Look for tool_use blocks in the response
                const toolUse = response.content.find(block => block.type === 'tool_use');
                if (toolUse) {
                    // Return in OpenAI function call format for compatibility
                    return {
                        choices: [{
                            message: {
                                function_call: {
                                    name: toolUse.name,
                                    arguments: JSON.stringify(toolUse.input)
                                }
                            }
                        }]
                    };
                }
                // If no tool_use block but tools were provided, throw error
                throw new Error('No tool_use block found in response');
            }

            // For regular responses, return the text content
            const textBlock = response.content.find(block => block.type === 'text');
            if (!textBlock) {
                throw new Error('No text block found in response');
            }
            return {
                choices: [{
                    message: {
                        content: textBlock.text
                    }
                }]
            };
        } catch (error) {
            // Handle specific API errors
            if (error.status === 429) {
                throw new Error('Rate limit exceeded. Please try again in a few seconds.');
            } else if (error.status === 413) {
                throw new Error('Input too long. Try reducing the content length.');
            } else if (error.status === 400 && error.message.includes('token')) {
                throw new Error('Token limit exceeded. Try reducing the input size or splitting the request.');
            } else if (error.status === 401) {
                throw new Error('Invalid API key or authentication error.');
            }
            
            // Log detailed error for debugging
            console.error('Claude API detailed error:', {
                status: error.status,
                message: error.message,
                type: error.type
            });

            throw new Error(`Claude API error: ${error.message}`);
        }
    }
} 