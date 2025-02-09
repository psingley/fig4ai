import OpenAI from 'openai';
import ora from 'ora';
import chalk from 'chalk';
import { rgbToHex } from '../utils/color.js';
import { ClaudeClient } from '../utils/claude-api.js';
import { processDesignTokens, formatTokenCount } from '../processors/token-processor.js';

let client;
let hasAICapability = false;

// Add Claude client as fallback for large frames
let claudeClient;
try {
    if (process.env.CLAUDE_API_KEY) {
        claudeClient = new ClaudeClient(process.env.CLAUDE_API_KEY);
    }
} catch (error) {
    console.warn(chalk.yellow('Failed to initialize Claude fallback:', error.message));
}

export function initializeAI(model = 'claude') {
    // Check if --no-ai flag is present
    if (process.argv.includes('--no-ai')) {
        hasAICapability = false;
        return;
    }

    try {
        if (model === 'gpt4' && process.env.OPENAI_API_KEY) {
            client = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
            hasAICapability = true;
        } else if (model === 'claude' && process.env.CLAUDE_API_KEY) {
            client = new ClaudeClient(process.env.CLAUDE_API_KEY);
            hasAICapability = true;
        }
    } catch (error) {
        console.warn(chalk.yellow('Failed to initialize AI client:', error.message));
        hasAICapability = false;
    }
}

// Enhanced rate limiting helpers
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const exponentialBackoff = (attempt, baseDelay = 2000) => Math.min(baseDelay * Math.pow(2, attempt), 120000);

class AIWrapper {
    static async callAI(client, messages, functions, options = { 
        chunkSize: 2000,
        baseDelay: 2000,
        maxRetries: 5,
        chunkDelay: 5000,
        maxGPT4Tokens: 6000  // Conservative limit for GPT-4
    }) {
        let attempt = 0;
        
        while (attempt < options.maxRetries) {
            try {
                // Estimate tokens in the message
                const estimatedTokens = messages[0].content.length / 4; // Rough estimation

                // For large frames, automatically use Claude if available
                if (client instanceof OpenAI && 
                    estimatedTokens > options.maxGPT4Tokens && 
                    claudeClient && 
                    messages[0].content.includes('Complete Frame Data:')) {
                    
                    console.log(chalk.blue(`Frame too large for GPT-4 (${Math.round(estimatedTokens)} estimated tokens), falling back to Claude...`));
                    return claudeClient.chat(messages, functions);
                }

                // Optimize the messages content
                const optimizedMessages = messages.map(msg => {
                    if (msg.content.length > options.chunkSize) {
                        // If it contains design system data, optimize it
                        if (msg.content.includes('Design System Details:')) {
                            const match = msg.content.match(/\`\`\`\n([\s\S]*?)\n\`\`\`/);
                            if (match) {
                                try {
                                    const designSystem = JSON.parse(match[1]);
                                    // Only keep the most relevant tokens
                                    const optimizedSystem = {
                                        typography: {
                                            headings: designSystem.typography.headings,
                                            body: designSystem.typography.body
                                        },
                                        colors: {
                                            primary: designSystem.colors.primary.slice(0, 5),
                                            secondary: designSystem.colors.secondary.slice(0, 5),
                                            text: designSystem.colors.text.slice(0, 3)
                                        },
                                        spacing: designSystem.spacing.slice(0, 5)
                                    };
                                    return {
                                        ...msg,
                                        content: msg.content.replace(match[0], '```\n' + JSON.stringify(optimizedSystem, null, 2) + '\n```')
                                    };
                                } catch (e) {
                                    console.warn('Failed to optimize design system data:', e);
                                    return msg;
                                }
                            }
                        }
                        
                        // If it contains frame data, optimize it
                        if (msg.content.includes('Complete Frame Data:')) {
                            const match = msg.content.match(/Complete Frame Data:\n\`\`\`\n([\s\S]*?)\n\`\`\`/);
                            if (match) {
                                try {
                                    const frameData = JSON.parse(match[1]);
                                    // Only keep essential frame properties
                                    const optimizedFrame = {
                                        id: frameData.id,
                                        name: frameData.name,
                                        type: frameData.type,
                                        layoutMode: frameData.layoutMode,
                                        itemSpacing: frameData.itemSpacing,
                                        paddingTop: frameData.paddingTop,
                                        paddingRight: frameData.paddingRight,
                                        paddingBottom: frameData.paddingBottom,
                                        paddingLeft: frameData.paddingLeft,
                                        backgroundColor: frameData.backgroundColor,
                                        absoluteBoundingBox: frameData.absoluteBoundingBox,
                                        constraints: frameData.constraints,
                                        children: frameData.children?.map(child => ({
                                            id: child.id,
                                            name: child.name,
                                            type: child.type,
                                            layoutMode: child.layoutMode,
                                            characters: child.characters
                                        }))
                                    };
                                    return {
                                        ...msg,
                                        content: msg.content.replace(match[0], 'Complete Frame Data:\n```\n' + JSON.stringify(optimizedFrame, null, 2) + '\n```')
                                    };
                                } catch (e) {
                                    console.warn('Failed to optimize frame data:', e);
                                    return msg;
                                }
                            }
                        }
                    }
                    return msg;
                });

                if (client instanceof OpenAI) {
                    // Add rate limiting for GPT-4
                    const delay = exponentialBackoff(attempt, options.baseDelay);
                    await sleep(delay);

                    // Split large frames into smaller chunks
                    if (messages[0].content.includes('Complete Frame Data:')) {
                        const frameMatch = messages[0].content.match(/Complete Frame Data:\n\`\`\`\n([\s\S]*?)\n\`\`\`/);
                        if (frameMatch && frameMatch[1].length > options.chunkSize) {
                            const frameData = JSON.parse(frameMatch[1]);
                            const chunks = [];
                            
                            // Process frame metadata first
                            chunks.push({
                                id: frameData.id,
                                name: frameData.name,
                                type: frameData.type,
                                layoutMode: frameData.layoutMode,
                                size: {
                                    width: frameData.absoluteBoundingBox?.width,
                                    height: frameData.absoluteBoundingBox?.height
                                }
                            });

                            // Process children in smaller chunks with longer delays
                            if (frameData.children) {
                                const chunkSize = 2; // Even smaller chunks
                                for (let i = 0; i < frameData.children.length; i += chunkSize) {
                                    const childrenChunk = frameData.children.slice(i, i + chunkSize);
                                    const processedChunk = childrenChunk.map(child => ({
                                        id: child.id,
                                        name: child.name,
                                        type: child.type,
                                        characters: child.characters,
                                        layoutMode: child.layoutMode
                                    }));
                                    chunks.push({
                                        ...chunks[0],
                                        children: processedChunk,
                                        childrenRange: `${i + 1}-${Math.min(i + chunkSize, frameData.children.length)} of ${frameData.children.length}`
                                    });
                                }
                            }

                            // Process each chunk with exponential backoff and minimum chunk delay
                            const results = [];
                            let currentIndex = 0;
                            while (currentIndex < chunks.length) {
                                // Add longer delay between chunks
                                if (currentIndex > 0) {
                                    const chunkDelay = Math.max(options.chunkDelay, exponentialBackoff(attempt, options.baseDelay));
                                    console.log(chalk.blue(`Waiting ${chunkDelay}ms between chunks...`));
                                    await sleep(chunkDelay);
                                }

                                const chunk = chunks[currentIndex];
                                const chunkMessage = {
                                    ...messages[0],
                                    content: messages[0].content.replace(
                                        frameMatch[0],
                                        'Complete Frame Data:\n```\n' + JSON.stringify(chunk, null, 2) + '\n```'
                                    )
                                };

                                try {
                                    const response = await client.chat.completions.create({
                                        model: "gpt-4",
                                        messages: [chunkMessage],
                                        functions: functions ? functions.map(fn => ({
                                            name: fn.name,
                                            description: fn.description,
                                            parameters: {
                                                type: "object",
                                                properties: fn.input_schema.properties,
                                                required: fn.input_schema.required
                                            }
                                        })) : undefined,
                                        function_call: functions ? { name: functions[0].name } : undefined,
                                        max_tokens: 1000
                                    });
                                    results.push(response);
                                    console.log(chalk.green(`Successfully processed chunk ${currentIndex + 1}/${chunks.length}`));
                                    currentIndex++; // Only increment on success
                                } catch (error) {
                                    if (error.status === 429) {
                                        console.warn(chalk.yellow(`Rate limit hit on chunk ${currentIndex + 1}, retrying with longer delay...`));
                                        attempt++;
                                        await sleep(exponentialBackoff(attempt, options.baseDelay * 2));
                                        continue; // Retry the same chunk
                                    }
                                    throw error;
                                }
                            }

                            // Combine results
                            const combinedPseudoCode = results.map(r => {
                                const args = JSON.parse(r.choices[0].message.function_call.arguments);
                                return args.pseudoCode;
                            }).join('\n');

                            return {
                                choices: [{
                                    message: {
                                        function_call: {
                                            name: functions[0].name,
                                            arguments: JSON.stringify({
                                                frameName: frameData.name,
                                                pseudoCode: combinedPseudoCode
                                            })
                                        }
                                    }
                                }]
                            };
                        }
                    }

                    // Default case for non-chunked requests
                    return await client.chat.completions.create({
                        model: "gpt-4",
                        messages: optimizedMessages,
                        functions: functions ? functions.map(fn => ({
                            name: fn.name,
                            description: fn.description,
                            parameters: {
                                type: "object",
                                properties: fn.input_schema.properties,
                                required: fn.input_schema.required
                            }
                        })) : undefined,
                        function_call: functions ? { name: functions[0].name } : undefined,
                        max_tokens: 1000
                    });
                } else {
                    // Use existing Claude format
                    return client.chat(optimizedMessages, functions);
                }
            } catch (error) {
                if (error.status === 429 && attempt < options.maxRetries - 1) {
                    attempt++;
                    const delay = exponentialBackoff(attempt, options.baseDelay);
                    console.warn(chalk.yellow(`Rate limit hit, retrying in ${delay}ms...`));
                    await sleep(delay);
                    continue;
                }
                throw error;
            }
        }
    }
}

async function generatePseudoComponent(component, instance, tokens, figmaData) {
    if (!hasAICapability || !client) {
        return {
            componentName: component.name,
            pseudoCode: `# ${component.name}\n\`\`\`\n${JSON.stringify(instance, null, 2)}\n\`\`\``
        };
    }

    // Create a more detailed design system summary with exact values
    const designSystem = {
        typography: {
            headings: Object.fromEntries(
                Object.entries(tokens.typography.headings)
                    .map(([key, styles]) => [key, styles[0]?.style || null])
                    .filter(([_, style]) => style !== null)
            ),
            body: tokens.typography.body[0]?.style || null
        },
        colors: {
            primary: tokens.colors.primary.map(c => ({ 
                name: c.name, 
                hex: c.hex,
                rgb: `${c.color.r},${c.color.g},${c.color.b}`,
                opacity: c.opacity
            })),
            secondary: tokens.colors.secondary.map(c => ({ 
                name: c.name, 
                hex: c.hex,
                rgb: `${c.color.r},${c.color.g},${c.color.b}`,
                opacity: c.opacity
            })),
            text: tokens.colors.text.map(c => ({ 
                name: c.name, 
                hex: c.hex,
                rgb: `${c.color.r},${c.color.g},${c.color.b}`,
                opacity: c.opacity
            })),
            background: tokens.colors.background.map(c => ({ 
                name: c.name, 
                hex: c.hex,
                rgb: `${c.color.r},${c.color.g},${c.color.b}`,
                opacity: c.opacity
            })),
            other: tokens.colors.other.map(c => ({ 
                name: c.name, 
                hex: c.hex,
                rgb: `${c.color.r},${c.color.g},${c.color.b}`,
                opacity: c.opacity
            }))
        },
        spacing: tokens.spacing.map(s => ({
            name: s.name,
            value: s.itemSpacing,
            padding: s.padding
        })),
        effects: {
            shadows: tokens.effects.shadows.map(s => ({
                name: s.name,
                type: s.type,
                ...s.value,
                color: s.value.color ? {
                    hex: rgbToHex(
                        Math.round(s.value.color.r * 255),
                        Math.round(s.value.color.g * 255),
                        Math.round(s.value.color.b * 255)
                    ),
                    rgb: `${Math.round(s.value.color.r * 255)},${Math.round(s.value.color.g * 255)},${Math.round(s.value.color.b * 255)}`,
                    opacity: s.value.color.a
                } : null
            })),
            blurs: tokens.effects.blurs.map(b => ({
                name: b.name,
                type: b.type,
                ...b.value
            }))
        }
    };

    // Extract component-specific styles and references
    const componentStyles = {
        styles: {},  // Will be populated with expanded styles
        fills: instance.fills?.map(fill => {
            if (fill.type === 'SOLID') {
                // Check if this fill comes from a style
                const styleId = instance.styles?.fills || instance.styles?.fill;
                if (styleId) {
                    // Find the style in tokens
                    const style = tokens.styles.find(s => s.id === styleId);
                    // Find the actual style definition in the Figma data
                    const styleDefinition = figmaData.styles?.[styleId];
                    return {
                        type: fill.type,
                        styleId,
                        styleName: style?.name || 'Unknown Style',
                        styleType: 'fill',
                        description: styleDefinition?.description || null,
                        color: {
                            hex: rgbToHex(
                                Math.round(fill.color.r * 255),
                                Math.round(fill.color.g * 255),
                                Math.round(fill.color.b * 255)
                            ),
                            rgb: `${Math.round(fill.color.r * 255)},${Math.round(fill.color.g * 255)},${Math.round(fill.color.b * 255)}`,
                            opacity: fill.color.a
                        }
                    };
                }
                return {
                    type: fill.type,
                    color: {
                        hex: rgbToHex(
                            Math.round(fill.color.r * 255),
                            Math.round(fill.color.g * 255),
                            Math.round(fill.color.b * 255)
                        ),
                        rgb: `${Math.round(fill.color.r * 255)},${Math.round(fill.color.g * 255)},${Math.round(fill.color.b * 255)}`,
                        opacity: fill.color.a
                    }
                };
            }
            return fill;
        }),
        effects: instance.effects?.map(effect => {
            const styleId = instance.styles?.effects || instance.styles?.effect;
            if (styleId) {
                const style = tokens.styles.find(s => s.id === styleId);
                const styleDefinition = figmaData.styles?.[styleId];
                return {
                    type: effect.type,
                    styleId,
                    styleName: style?.name || 'Unknown Style',
                    styleType: 'effect',
                    description: styleDefinition?.description || null,
                    value: {
                        ...effect,
                        color: effect.color ? {
                            hex: rgbToHex(
                                Math.round(effect.color.r * 255),
                                Math.round(effect.color.g * 255),
                                Math.round(effect.color.b * 255)
                            ),
                            rgb: `${Math.round(effect.color.r * 255)},${Math.round(effect.color.g * 255)},${Math.round(effect.color.b * 255)}`,
                            opacity: effect.color.a
                        } : null
                    }
                };
            }
            return effect;
        })
    };

    // Expand all style references
    if (instance.styles) {
        Object.entries(instance.styles).forEach(([key, styleId]) => {
            const style = tokens.styles.find(s => s.id === styleId);
            const styleDefinition = figmaData.styles?.[styleId];
            
            componentStyles.styles[key] = {
                id: styleId,
                name: style?.name || 'Unknown Style',
                type: key,
                description: styleDefinition?.description || null,
                value: styleDefinition || null
            };
        });
    }

    const functions = [
        {
            name: "create_pseudo_component",
            description: "Generate a pseudo-XML component based on Figma component details. The component should include all styling information, using style references when available and direct values when not. The output should be valid XML-like syntax with proper nesting and attribute formatting. Consider accessibility, maintainability, and design system consistency in the output.",
            input_schema: {
                type: "object",
                properties: {
                    componentName: {
                        type: "string",
                        description: "The name of the component"
                    },
                    pseudoCode: {
                        type: "string",
                        description: "The pseudo-XML code for the component with detailed styling, including accessibility attributes, style references, and comprehensive documentation"
                    }
                },
                required: ["componentName", "pseudoCode"]
            }
        }
    ];

    const prompt = `Design System Details:

\`\`\`
${JSON.stringify(designSystem, null, 2)}
\`\`\`

Component to Generate:
Name: ${component.name}
Type: ${component.type}
Description: ${component.description || 'No description provided'}
Size: ${instance.size.width}x${instance.size.height}

Component Specific Styles and References:
\`\`\`
${JSON.stringify(componentStyles, null, 2)}
\`\`\`

Requirements:
1. Generate semantic, accessible pseudo-XML code that represents this component
2. Use style references (styleId) when available instead of direct values
3. Include ALL styling details (colors, shadows, effects) with exact values
4. Include ARIA attributes and roles for accessibility
5. Document style decisions and token usage in comments
6. Specify exact padding, margins, and spacing values
7. Include responsive behavior hints
8. Add semantic class names and data attributes
9. Include state handling (hover, focus, active)
10. Document any accessibility considerations

Example format:
<Button 
  styleId="style_123"
  role="button"
  aria-label="Primary action button"
  data-component="primary-button"
  className="primary-action-btn"
  states="hover:opacity-80 focus:ring-2"
  // ... rest of the attributes ...
>
  <Icon name="star" fills="style_id_234" />
  <Text fills="style_id_567" font-size="16px">Click me</Text>
</Button>

Generate ONLY the pseudo-XML code with detailed styling attributes, preferring style references over direct values.`;

    try {
        const completion = await AIWrapper.callAI(
            client,
            [{ role: "user", content: prompt }],
            functions
        );

        const response = JSON.parse(completion.choices[0].message.function_call.arguments);
        return response;
    } catch (error) {
        console.warn(chalk.yellow(`Skipping pseudo generation for component ${component.name} - ${error.message}`));
        return {
            componentName: component.name,
            pseudoCode: `# ${component.name}\n${JSON.stringify(instance, null, 2)}`
        };
    }
}

async function generatePseudoFrame(frame, components, tokens, canvas) {
    if (!hasAICapability || !client) {
        return {
            frameName: frame.name,
            pseudoCode: `# ${frame.name} (Canvas: ${canvas.name})\n${JSON.stringify(frame, null, 2)}`
        };
    }

    // Always use Claude for frames if available
    const frameClient = claudeClient || client;
    console.log(chalk.blue(`Using ${claudeClient ? 'Claude' : 'GPT-4'} for frame processing...`));

    const functions = [
        {
            name: "create_pseudo_frame",
            description: "Generate a pseudo-XML frame layout based on Figma frame details. The frame should include all layout information, styling, and nested elements. The output must be valid XML-like syntax that accurately represents the Figma frame structure, including positioning, constraints, and styling.",
            input_schema: {
                type: "object",
                properties: {
                    frameName: {
                        type: "string",
                        description: "The name of the frame"
                    },
                    pseudoCode: {
                        type: "string",
                        description: "The pseudo-XML code for the frame layout with all styling and structure details"
                    }
                },
                required: ["frameName", "pseudoCode"]
            }
        }
    ];

    // Extract frame dimensions and properties for the summary
    const frameSize = frame.absoluteBoundingBox ? {
        width: frame.absoluteBoundingBox.width,
        height: frame.absoluteBoundingBox.height
    } : { width: 0, height: 0 };

    const framePadding = {
        top: frame.paddingTop || 0,
        right: frame.paddingRight || 0,
        bottom: frame.paddingBottom || 0,
        left: frame.paddingLeft || 0
    };

    const canvasSize = canvas.absoluteBoundingBox ? {
        width: canvas.absoluteBoundingBox.width,
        height: canvas.absoluteBoundingBox.height
    } : { width: 0, height: 0 };

    const prompt = `Frame Summary:
Name: ${frame.name}
Size: ${frameSize.width}x${frameSize.height}
Layout: ${frame.layoutMode || 'FREE'}
Spacing: ${frame.itemSpacing || 0}
Padding: ${JSON.stringify(framePadding)}
Elements: ${frame.children?.length || 0}
Position: x=${frame.absoluteBoundingBox?.x || 0}, y=${frame.absoluteBoundingBox?.y || 0}

Canvas Summary:
Name: ${canvas.name}
Type: ${canvas.type}
Size: ${canvasSize.width}x${canvasSize.height}

Available Components:
${components.map(c => `- ${c.name}`).join('\n')}

Complete Frame Data:
\`\`\`
${JSON.stringify(frame, null, 2)}
\`\`\`

Complete Canvas Data:
\`\`\`
${JSON.stringify(canvas, null, 2)}
\`\`\`

Requirements:
1. Generate pseudo-XML layout code for this frame
2. Use semantic container elements
3. Include layout attributes (flex, grid, etc.)
4. Use appropriate spacing and padding
5. Place components in a logical layout
6. Consider canvas context for positioning and constraints
7. Include all text content exactly as specified in the frame data
8. Preserve all styling information from the frame data
9. Keep the hierarchy of nested elements
10. Keep it readable while being accurate to the source data

Example format:
<Frame 
  name="${frame.name}" 
  layout="${frame.layoutMode || 'FREE'}" 
  spacing="${frame.itemSpacing || 0}" 
  canvas="${canvas.name}"
  position="x=${frame.absoluteBoundingBox?.x || 0},y=${frame.absoluteBoundingBox?.y || 0}"
  size="w=${frameSize.width},h=${frameSize.height}"
  constraints="${JSON.stringify(frame.constraints)}"
  background="${JSON.stringify(frame.backgroundColor)}"
  blendMode="${frame.blendMode}"
  clipsContent="${frame.clipsContent}"
>
  <!-- Generate nested elements based on frame.children -->
  <!-- Include all text content, styles, and properties -->
  <!-- Use style references when available -->
</Frame>

Generate ONLY the pseudo-XML code without any additional explanation. Ensure all text content and styling from the frame data is accurately represented.`;

    try {
        const completion = await AIWrapper.callAI(
            frameClient,
            [{ role: "user", content: prompt }],
            functions
        );

        const response = JSON.parse(completion.choices[0].message.function_call.arguments);
        return response;
    } catch (error) {
        console.warn(chalk.yellow(`Skipping pseudo generation for frame ${frame.name} - ${error.message}`));
        return {
            frameName: frame.name,
            pseudoCode: `# ${frame.name} (Canvas: ${canvas.name})\n${JSON.stringify(frame, null, 2)}`
        };
    }
}

export async function generateAllPseudoCode(components, instances, frames, tokens, figmaData) {
    const pseudoComponents = new Map();
    const spinner = ora();

    if (!hasAICapability) {
        spinner.info('Running without AI enhancement - will output raw data');
    }

    // Generate components first
    spinner.start('Processing components...');
    for (const component of components) {
        spinner.text = `Processing component: ${component.name}`;
        const componentInstances = instances.filter(i => i.componentId === component.id);
        if (componentInstances.length > 0) {
            const mainInstance = componentInstances[0];
            const pseudoComponent = await generatePseudoComponent(component, mainInstance, tokens, figmaData);
            if (pseudoComponent) {
                pseudoComponents.set(component.id, pseudoComponent);
                spinner.stop();
                console.log(chalk.green(`✓ Processed component: ${component.name}`));
                spinner.start();
            }
        }
    }
    spinner.succeed('All components processed');

    spinner.start('Processing frame layouts...');
    const pseudoFrames = new Map();

    // Generate frames using the components
    for (const canvas of figmaData.document.children) {
        spinner.stop();
        console.log(chalk.blue(`\nProcessing canvas: ${canvas.name}`));
        spinner.start();
        for (const frame of canvas.children?.filter(child => child.type === 'FRAME') || []) {
            spinner.text = `Processing frame: ${frame.name}`;
            const pseudoFrame = await generatePseudoFrame(frame, components, tokens, canvas);
            if (pseudoFrame) {
                pseudoFrames.set(frame.id, pseudoFrame);
                spinner.stop();
                console.log(chalk.green(`  ✓ Processed frame: ${frame.name}`));
                spinner.start();
            }
        }
    }
    spinner.succeed('All frames processed');

    return { components: pseudoComponents, frames: pseudoFrames };
}