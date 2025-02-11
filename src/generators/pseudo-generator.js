import OpenAI from 'openai';
import ora from 'ora';
import chalk from 'chalk';
import { rgbToHex } from '../utils/color.js';
import { ClaudeClient } from '../utils/claude-api.js';

let client;
let hasAICapability = false;
let currentModel = 'claude';

// Function to convert to OpenAI function format
function toOpenAIFormat(functions) {
    return functions.map(fn => {
        // For OpenAI, we need to flatten the schema slightly differently
        // and ensure all nested objects are properly defined
        const parameters = {
            type: "object",
            properties: {
                ...fn.input_schema.properties,
                // Ensure nested objects are properly defined for OpenAI's schema
                layout: {
                    type: "object",
                    description: "Layout system details",
                    properties: {
                        type: {
                            type: "string",
                            enum: ["flex", "grid", "free"],
                            description: "The type of layout system used"
                        },
                        spacing: {
                            type: "number",
                            description: "Space between elements"
                        },
                        padding: {
                            type: "object",
                            description: "Frame padding values",
                            properties: {
                                top: { type: "number" },
                                right: { type: "number" },
                                bottom: { type: "number" },
                                left: { type: "number" }
                            },
                            required: ["top", "right", "bottom", "left"]
                        }
                    },
                    required: ["type", "spacing", "padding"]
                },
                styling: {
                    type: "object",
                    description: "Frame styling information",
                    properties: {
                        background: {
                            type: "object",
                            description: "Background styling",
                            properties: {
                                color: { type: "string" },
                                opacity: { type: "number" }
                            }
                        },
                        effects: {
                            type: "array",
                            description: "Visual effects like shadows",
                            items: {
                                type: "object",
                                properties: {
                                    type: { type: "string" },
                                    value: { type: "object" }
                                }
                            }
                        },
                        constraints: {
                            type: "object",
                            description: "Layout constraints",
                            properties: {
                                horizontal: { type: "string" },
                                vertical: { type: "string" }
                            }
                        }
                    },
                    required: ["background", "effects", "constraints"]
                }
            },
            required: fn.input_schema.required
        };

        return {
            name: fn.name,
            description: fn.description,
            parameters
        };
    });
}

// Function to convert to Claude tool format
function toClaudeFormat(functions) {
    return functions.map(fn => ({
        name: fn.name,
        description: fn.description,
        input_schema: fn.input_schema
    }));
}

export function initializeAI(model = 'claude') {
    // Check if --no-ai flag is present
    if (process.argv.includes('--no-ai')) {
        hasAICapability = false;
        return;
    }

    try {
        currentModel = model.toLowerCase();
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
        const formattedFunctions = currentModel === 'gpt4' ? toOpenAIFormat(functions) : toClaudeFormat(functions);
        
        if (currentModel === 'gpt4') {
            const completion = await client.chat.completions.create({
                model: 'gpt-4',
                messages: [{ role: "user", content: prompt }],
                functions: formattedFunctions,
                function_call: { name: "create_pseudo_component" }
            });

            const response = JSON.parse(completion.choices[0].message.function_call.arguments);
            return response;
        } else {
            const completion = await client.chat(
                [{ role: "user", content: prompt }],
                formattedFunctions,
                { name: "create_pseudo_component" }
            );

            const response = JSON.parse(completion.choices[0].message.function_call.arguments);
            return response;
        }
    } catch (error) {
        console.warn(chalk.yellow(`Skipping pseudo generation for component ${component.name} - ${error.message}`));
        return {
            componentName: component.name,
            pseudoCode: `# ${component.name}\n${JSON.stringify(instance, null, 2)}`
        };
    }
}

function determineElementType(node) {
    if (node.type === 'RECTANGLE') {
        // Convert to Image only if there's clear image evidence
        if (node.fills?.some(fill => 
            fill.type === 'IMAGE' || 
            fill.imageRef || 
            fill.imageHash
        )) {
            return 'Image';
        }
        return 'Rectangle';
    }
    
    if (node.type === 'FRAME') {
        // Convert to semantic containers based on content/purpose
        if (node.children?.every(child => 
            child.type === 'TEXT' || 
            child.layoutMode === 'VERTICAL'
        )) {
            return 'Container';
        }
        return 'Frame';
    }

    return node.type;
}

async function generatePseudoFrame(frame, components, tokens, canvas) {
    if (!hasAICapability || !client) {
        return {
            frameName: frame.name,
            pseudoCode: `# ${frame.name} (Canvas: ${canvas.name})\n${JSON.stringify(frame, null, 2)}`
        };
    }

    const functions = [
        {
            name: "create_pseudo_frame",
            description: "Generate a semantic, accessible pseudo-XML frame layout based on Figma frame details. Focus on capturing layout structure, styling, and component relationships in a maintainable format.",
            input_schema: {
                type: "object",
                properties: {
                    frameName: {
                        type: "string",
                        description: "The name of the frame"
                    },
                    pseudoCode: {
                        type: "string",
                        description: "The semantic pseudo-XML code for the frame layout"
                    },
                    layout: {
                        type: "object",
                        description: "Layout system details",
                        properties: {
                            type: { 
                                type: "string",
                                enum: ["stack", "grid", "free"],
                                description: "Primary layout type"
                            },
                            direction: {
                                type: "string",
                                enum: ["vertical", "horizontal"],
                                description: "Stack direction"
                            },
                            alignment: {
                                type: "object",
                                properties: {
                                    main: {
                                        type: "string",
                                        enum: ["start", "center", "end", "spaceBetween"],
                                        description: "Main axis alignment"
                                    },
                                    cross: {
                                        type: "string",
                                        enum: ["start", "center", "end", "stretch"],
                                        description: "Cross axis alignment"
                                    }
                                }
                            },
                            spacing: {
                                type: "number",
                                description: "Space between elements"
                            },
                            padding: {
                                type: "object",
                                properties: {
                                    top: { type: "number" },
                                    right: { type: "number" },
                                    bottom: { type: "number" },
                                    left: { type: "number" }
                                }
                            }
                        }
                    },
                    styling: {
                        type: "object",
                        description: "Visual styling",
                        properties: {
                            typography: {
                                type: "object",
                                properties: {
                                    font: {
                                        type: "object",
                                        properties: {
                                            family: { type: "string" },
                                            weight: { type: "number" },
                                            size: { type: "number" },
                                            lineHeight: { type: "string" },
                                            letterSpacing: { type: "string" },
                                            style: { type: "string" }
                                        }
                                    },
                                    color: {
                                        type: "object",
                                        properties: {
                                            hex: { type: "string" },
                                            opacity: { type: "number" }
                                        }
                                    }
                                }
                            },
                            background: {
                                type: "object",
                                properties: {
                                    type: {
                                        type: "string",
                                        enum: ["color", "image", "gradient"]
                                    },
                                    value: { type: "string" }
                                }
                            },
                            border: {
                                type: "object",
                                properties: {
                                    radius: {
                                        type: "array",
                                        items: { type: "number" },
                                        minItems: 4,
                                        maxItems: 4,
                                        description: "Corner radii [topLeft, topRight, bottomRight, bottomLeft]"
                                    }
                                }
                            },
                            effects: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        type: {
                                            type: "string",
                                            enum: ["shadow", "blur", "inner-shadow"]
                                        },
                                        value: { type: "object" }
                                    }
                                }
                            }
                        }
                    }
                },
                required: ["frameName", "pseudoCode", "layout", "styling"]
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
Type: ${determineElementType(frame)}
Size: ${frameSize.width}x${frameSize.height}
Layout: ${frame.layoutMode || 'FREE'}
Spacing: ${frame.itemSpacing || 0}
Padding: ${JSON.stringify(framePadding)}
Elements: ${frame.children?.length || 0}

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
1. Use semantic element types (Container, Image, Text) based on content
2. Include complete font details for all text elements
3. Use stack-based layout with proper direction and alignment
4. Include border radius and effects when present
5. Only use position information for free layout or absolute positioning
6. Convert Rectangle to Image only when image evidence exists
7. Preserve all text content exactly as specified
8. Keep styling information semantic and complete
9. Maintain proper nesting and hierarchy
10. Focus on maintainability and readability

Example format:
<Container 
    name="Card" 
    layout="stack" 
    direction="vertical" 
    spacing="16"
>
    <Image 
        name="Thumbnail"
        fill="stretch"
        cornerRadius="8,8,0,0"
        imageRef="abc123"
    />
    <Text
        content="Heading"
        typography={{
            font: {
                family: "Inter",
                weight: 600,
                size: 16,
                lineHeight: "24px"
            },
            color: {
                hex: "#000000",
                opacity: 1
            }
        }}
    />
</Container>

Generate ONLY the pseudo-XML code without any additional explanation. Ensure all text content and styling from the frame data is accurately represented.`;

    try {
        const formattedFunctions = currentModel === 'gpt4' ? toOpenAIFormat(functions) : toClaudeFormat(functions);
        
        if (currentModel === 'gpt4') {
            const completion = await client.chat.completions.create({
                model: 'gpt-4',
                messages: [{ role: "user", content: prompt }],
                functions: formattedFunctions,
                function_call: { name: "create_pseudo_frame" }
            });

            const response = JSON.parse(completion.choices[0].message.function_call.arguments);
            return response;
        } else {
            const completion = await client.chat(
                [{ role: "user", content: prompt }],
                formattedFunctions,
                { name: "create_pseudo_frame" }
            );

            const response = JSON.parse(completion.choices[0].message.function_call.arguments);
            return response;
        }
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