#!/usr/bin/env node

import chalk from 'chalk';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import OpenAI from 'openai';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(dirname(__dirname), '.env') });

const figmaUrl = process.argv[2];

if (!figmaUrl) {
    console.error(chalk.red('Please provide a Figma URL'));
    process.exit(1);
}

if (!process.env.FIGMA_ACCESS_TOKEN) {
    console.error(chalk.red('Please set FIGMA_ACCESS_TOKEN in your .env file'));
    process.exit(1);
}

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

function parseFigmaUrl(url) {
    try {
        // Handle URLs without protocol
        const urlWithProtocol = url.startsWith('http') ? url : `https://${url}`;
        const urlObj = new URL(urlWithProtocol);
        
        if (!urlObj.hostname.includes('figma.com')) {
            throw new Error('Not a valid Figma URL');
        }

        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        const fileId = pathParts[1];
        const nodeId = urlObj.searchParams.get('node-id');
        
        // Extract additional parameters
        const page = urlObj.searchParams.get('p');
        const type = urlObj.searchParams.get('t');
        const title = pathParts[2] ? decodeURIComponent(pathParts[2]) : null;

        return {
            type: pathParts[0], // 'file' or 'design'
            fileId,
            nodeId,
            page,
            viewType: type,
            title,
            fullPath: urlObj.pathname,
            originalUrl: url,
            params: Object.fromEntries(urlObj.searchParams)
        };
    } catch (error) {
        throw new Error('Invalid URL format');
    }
}

function processDesignTokens(node, tokens = {
    typography: {
        headings: {
            h1: [], h2: [], h3: [], h4: [], h5: [], h6: []
        },
        body: [],
        other: []
    },
    colors: {
        primary: [],
        secondary: [],
        text: [],
        background: [],
        other: []
    },
    spacing: [],
    effects: {
        shadows: [],
        blurs: [],
        other: []
    },
    components: [],
    styles: []
}, parentName = '') {
    if (!node) return tokens;

    const fullName = parentName ? `${parentName}/${node.name}` : node.name;
    const nameLower = node.name.toLowerCase();

    // Process node based on type
    switch (node.type) {
        case 'COMPONENT':
        case 'COMPONENT_SET':
            tokens.components.push({
                id: node.id,
                name: fullName,
                type: node.type,
                description: node.description || null,
                styles: node.styles || null
            });
            break;

        case 'TEXT':
            const textStyle = {
                id: node.id,
                name: fullName,
                content: node.characters,
                style: {
                    fontFamily: node.style?.fontFamily,
                    fontWeight: node.style?.fontWeight,
                    fontSize: node.style?.fontSize,
                    lineHeight: node.style?.lineHeightPx || node.style?.lineHeight,
                    letterSpacing: node.style?.letterSpacing,
                    textCase: node.style?.textCase,
                    textDecoration: node.style?.textDecoration,
                    textAlignHorizontal: node.style?.textAlignHorizontal,
                    paragraphSpacing: node.style?.paragraphSpacing,
                    fills: node.fills
                }
            };

            // Categorize typography
            if (nameLower.includes('heading') || nameLower.match(/h[1-6]/)) {
                const headingLevel = nameLower.match(/h([1-6])/)?.[1];
                if (headingLevel) {
                    tokens.typography.headings[`h${headingLevel}`].push(textStyle);
                }
            } else if (nameLower.includes('body') || nameLower.includes('text') || nameLower.includes('paragraph')) {
                tokens.typography.body.push(textStyle);
            } else {
                tokens.typography.other.push(textStyle);
            }
            break;

        case 'RECTANGLE':
        case 'VECTOR':
        case 'ELLIPSE':
            if (node.fills && node.fills.length > 0) {
                node.fills.forEach(fill => {
                    if (fill.type === 'SOLID') {
                        const colorToken = {
                            id: node.id,
                            name: fullName,
                            color: {
                                r: Math.round(fill.color.r * 255),
                                g: Math.round(fill.color.g * 255),
                                b: Math.round(fill.color.b * 255),
                                a: fill.color.a,
                            },
                            hex: rgbToHex(
                                Math.round(fill.color.r * 255),
                                Math.round(fill.color.g * 255),
                                Math.round(fill.color.b * 255)
                            ),
                            opacity: fill.color.a
                        };

                        // Categorize colors
                        if (nameLower.includes('primary')) {
                            tokens.colors.primary.push(colorToken);
                        } else if (nameLower.includes('secondary')) {
                            tokens.colors.secondary.push(colorToken);
                        } else if (nameLower.includes('text') || nameLower.includes('typography')) {
                            tokens.colors.text.push(colorToken);
                        } else if (nameLower.includes('background') || nameLower.includes('bg')) {
                            tokens.colors.background.push(colorToken);
                        } else {
                            tokens.colors.other.push(colorToken);
                        }
                    }
                });
            }

            // Process effects
            if (node.effects && node.effects.length > 0) {
                node.effects.forEach(effect => {
                    const effectToken = {
                        id: node.id,
                        name: fullName,
                        type: effect.type,
                        value: effect
                    };

                    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
                        tokens.effects.shadows.push(effectToken);
                    } else if (effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR') {
                        tokens.effects.blurs.push(effectToken);
                    } else {
                        tokens.effects.other.push(effectToken);
                    }
                });
            }
            break;

        case 'FRAME':
            // Process spacing from auto-layout frames
            if (node.layoutMode === 'VERTICAL' || node.layoutMode === 'HORIZONTAL') {
                tokens.spacing.push({
                    id: node.id,
                    name: fullName,
                    type: node.layoutMode,
                    itemSpacing: node.itemSpacing,
                    padding: {
                        top: node.paddingTop,
                        right: node.paddingRight,
                        bottom: node.paddingBottom,
                        left: node.paddingLeft
                    }
                });
            }
            break;
    }

    // Process styles if present
    if (node.styles) {
        tokens.styles.push({
            id: node.id,
            name: fullName,
            styles: node.styles
        });
    }

    // Recursively process children
    if (node.children) {
        node.children.forEach(child => {
            processDesignTokens(child, tokens, fullName);
        });
    }

    return tokens;
}

// Helper function to convert RGB to HEX
function rgbToHex(r, g, b) {
    const toHex = (n) => {
        const hex = n.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function formatTokenCount(tokens) {
    let counts = {
        typography: Object.values(tokens.typography.headings).flat().length + 
                   tokens.typography.body.length + 
                   tokens.typography.other.length,
        colors: Object.values(tokens.colors).flat().length,
        effects: Object.values(tokens.effects).flat().length,
        spacing: tokens.spacing.length,
        components: tokens.components.length,
        styles: tokens.styles.length
    };
    return Object.entries(counts)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');
}

function printDetailedTokens(tokens) {
    // Typography
    console.log(chalk.green('\nTYPOGRAPHY:'));
    
    // Headings
    Object.entries(tokens.typography.headings).forEach(([level, styles]) => {
        if (styles.length > 0) {
            console.log(chalk.blue(`\n${level.toUpperCase()}:`));
            styles.forEach(style => {
                console.log(chalk.white(`  ${style.name}`));
                console.log(chalk.gray(`    Font: ${style.style.fontFamily} (${style.style.fontWeight})`));
                console.log(chalk.gray(`    Size: ${style.style.fontSize}px`));
                console.log(chalk.gray(`    Line Height: ${style.style.lineHeight}`));
                if (style.style.letterSpacing) {
                    console.log(chalk.gray(`    Letter Spacing: ${style.style.letterSpacing}`));
                }
            });
        }
    });

    // Body styles
    if (tokens.typography.body.length > 0) {
        console.log(chalk.blue('\nBODY STYLES:'));
        tokens.typography.body.forEach(style => {
            console.log(chalk.white(`  ${style.name}`));
            console.log(chalk.gray(`    Font: ${style.style.fontFamily} (${style.style.fontWeight})`));
            console.log(chalk.gray(`    Size: ${style.style.fontSize}px`));
            console.log(chalk.gray(`    Line Height: ${style.style.lineHeight}`));
        });
    }

    // Colors
    console.log(chalk.green('\nCOLORS:'));
    Object.entries(tokens.colors).forEach(([category, colors]) => {
        if (colors.length > 0) {
            console.log(chalk.blue(`\n${category.toUpperCase()}:`));
            colors.forEach(color => {
                console.log(chalk.white(`  ${color.name}`));
                console.log(chalk.gray(`    HEX: ${color.hex}`));
                console.log(chalk.gray(`    RGB: ${color.color.r}, ${color.color.g}, ${color.color.b}`));
                if (color.opacity !== 1) {
                    console.log(chalk.gray(`    Opacity: ${color.opacity}`));
                }
            });
        }
    });

    // Effects
    if (Object.values(tokens.effects).some(arr => arr.length > 0)) {
        console.log(chalk.green('\nEFFECTS:'));
        Object.entries(tokens.effects).forEach(([category, effects]) => {
            if (effects.length > 0) {
                console.log(chalk.blue(`\n${category.toUpperCase()}:`));
                effects.forEach(effect => {
                    console.log(chalk.white(`  ${effect.name}`));
                    console.log(chalk.gray(`    Type: ${effect.type}`));
                });
            }
        });
    }

    // Spacing
    if (tokens.spacing.length > 0) {
        console.log(chalk.green('\nSPACING:'));
        tokens.spacing.forEach(space => {
            console.log(chalk.white(`  ${space.name}`));
            console.log(chalk.gray(`    Type: ${space.type}`));
            console.log(chalk.gray(`    Item Spacing: ${space.itemSpacing}`));
            if (Object.values(space.padding).some(v => v !== 0)) {
                console.log(chalk.gray(`    Padding: ${space.padding.top} ${space.padding.right} ${space.padding.bottom} ${space.padding.left}`));
            }
        });
    }
}

function processCanvases(document) {
    if (!document || !document.children) return [];

    return document.children.map(canvas => {
        const frames = canvas.children
            ?.filter(child => child.type === 'FRAME')
            ?.map(frame => ({
                id: frame.id,
                name: frame.name,
                type: frame.type,
                size: {
                    width: frame.absoluteBoundingBox?.width || null,
                    height: frame.absoluteBoundingBox?.height || null
                },
                position: {
                    x: frame.x || 0,
                    y: frame.y || 0
                },
                background: frame.backgroundColor,
                layoutMode: frame.layoutMode,
                itemSpacing: frame.itemSpacing,
                padding: {
                    top: frame.paddingTop,
                    right: frame.paddingRight,
                    bottom: frame.paddingBottom,
                    left: frame.paddingLeft
                },
                constraints: frame.constraints,
                clipsContent: frame.clipsContent,
                elements: frame.children?.length || 0
            })) || [];

        return {
            id: canvas.id,
            name: canvas.name,
            type: canvas.type,
            backgroundColor: canvas.backgroundColor,
            children: canvas.children ? canvas.children.length : 0,
            size: {
                width: canvas.absoluteBoundingBox?.width || null,
                height: canvas.absoluteBoundingBox?.height || null
            },
            constraints: canvas.constraints || null,
            exportSettings: canvas.exportSettings || [],
            flowStartingPoints: canvas.flowStartingPoints || [],
            prototypeStartNode: canvas.prototypeStartNode || null,
            frames
        };
    });
}

function printCanvasDetails(canvases) {
    console.log(chalk.green('\nCANVASES AND FRAMES:'));
    canvases.forEach(canvas => {
        console.log(chalk.blue(`\n${canvas.name}:`));
        console.log(chalk.gray(`  ID: ${canvas.id}`));
        console.log(chalk.gray(`  Type: ${canvas.type}`));
        console.log(chalk.gray(`  Total Elements: ${canvas.children}`));
        
        if (canvas.size.width && canvas.size.height) {
            console.log(chalk.gray(`  Size: ${canvas.size.width}x${canvas.size.height}`));
        }
        
        if (canvas.backgroundColor) {
            const bg = canvas.backgroundColor;
            const hex = rgbToHex(
                Math.round(bg.r * 255),
                Math.round(bg.g * 255),
                Math.round(bg.b * 255)
            );
            console.log(chalk.gray(`  Background: ${hex} (opacity: ${bg.a})`));
        }

        if (canvas.flowStartingPoints && canvas.flowStartingPoints.length > 0) {
            console.log(chalk.gray(`  Prototype Starting Points: ${canvas.flowStartingPoints.length}`));
        }

        if (canvas.exportSettings && canvas.exportSettings.length > 0) {
            console.log(chalk.gray(`  Export Settings: ${canvas.exportSettings.length} formats`));
        }

        // Print frames information
        if (canvas.frames && canvas.frames.length > 0) {
            console.log(chalk.yellow(`\n  Frames (${canvas.frames.length}):`));
            canvas.frames.forEach(frame => {
                console.log(chalk.white(`\n    ${frame.name}:`));
                console.log(chalk.gray(`      ID: ${frame.id}`));
                if (frame.size.width && frame.size.height) {
                    console.log(chalk.gray(`      Size: ${frame.size.width}x${frame.size.height}`));
                }
                console.log(chalk.gray(`      Position: x=${frame.position.x}, y=${frame.position.y}`));
                console.log(chalk.gray(`      Elements: ${frame.elements}`));
                
                if (frame.layoutMode) {
                    console.log(chalk.gray(`      Layout: ${frame.layoutMode}`));
                    console.log(chalk.gray(`      Item Spacing: ${frame.itemSpacing}`));
                    const hasPadding = Object.values(frame.padding).some(v => v !== 0);
                    if (hasPadding) {
                        console.log(chalk.gray(`      Padding: ${frame.padding.top} ${frame.padding.right} ${frame.padding.bottom} ${frame.padding.left}`));
                    }
                }
                
                if (frame.constraints) {
                    console.log(chalk.gray(`      Constraints: ${JSON.stringify(frame.constraints)}`));
                }
            });
        }
    });
}

async function getFigmaFileData(fileId) {
    const response = await fetch(`https://api.figma.com/v1/files/${fileId}`, {
        headers: {
            'X-Figma-Token': process.env.FIGMA_ACCESS_TOKEN
        }
    });

    if (!response.ok) {
        throw new Error(`Figma API error: ${response.statusText}`);
    }

    return response.json();
}

function processComponentInstances(node, instances = [], parentName = '') {
    if (!node) return instances;

    const fullName = parentName ? `${parentName}/${node.name}` : node.name;

    if (node.type === 'INSTANCE') {
        instances.push({
            id: node.id,
            name: fullName,
            componentId: node.componentId,
            mainComponent: node.mainComponent,
            styles: node.styles || null,
            position: {
                x: node.x || 0,
                y: node.y || 0
            },
            size: {
                width: node.absoluteBoundingBox?.width || null,
                height: node.absoluteBoundingBox?.height || null
            }
        });
    }

    if (node.children) {
        node.children.forEach(child => {
            processComponentInstances(child, instances, fullName);
        });
    }

    return instances;
}

function generateComponentYAML(components, instances) {
    // Create a map of component IDs to their instances
    const componentMap = new Map();
    components.forEach(comp => {
        componentMap.set(comp.id, {
            name: comp.name,
            type: comp.type,
            description: comp.description,
            instances: []
        });
    });

    // Map instances to their components
    instances.forEach(instance => {
        if (componentMap.has(instance.componentId)) {
            componentMap.get(instance.componentId).instances.push({
                id: instance.id,
                name: instance.name
            });
        }
    });

    // Generate YAML-like string
    let yaml = 'components:\n';
    componentMap.forEach((value, key) => {
        yaml += `  ${key}:\n`;
        yaml += `    name: "${value.name}"\n`;
        yaml += `    type: ${value.type}\n`;
        if (value.description) {
            yaml += `    description: "${value.description}"\n`;
        }
        if (value.instances.length > 0) {
            yaml += '    instances:\n';
            value.instances.forEach(instance => {
                yaml += `      - id: ${instance.id}\n`;
                yaml += `        name: "${instance.name}"\n`;
            });
        }
        yaml += '\n';
    });

    return yaml;
}

function printComponentInstances(instances) {
    console.log(chalk.green('\nCOMPONENT INSTANCES:'));
    instances.forEach(instance => {
        console.log(chalk.blue(`\n${instance.name}:`));
        console.log(chalk.gray(`  ID: ${instance.id}`));
        console.log(chalk.gray(`  Component ID: ${instance.componentId}`));
        if (instance.size.width && instance.size.height) {
            console.log(chalk.gray(`  Size: ${instance.size.width}x${instance.size.height}`));
        }
        console.log(chalk.gray(`  Position: x=${instance.position.x}, y=${instance.position.y}`));
        if (instance.styles) {
            console.log(chalk.gray('  Styles:'));
            Object.entries(instance.styles).forEach(([key, value]) => {
                console.log(chalk.gray(`    ${key}: ${value}`));
            });
        }
    });
}

async function generatePseudoComponent(component, instance, tokens) {
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
            primary: tokens.colors.primary.map(c => ({ name: c.name, hex: c.hex })),
            secondary: tokens.colors.secondary.map(c => ({ name: c.name, hex: c.hex })),
            text: tokens.colors.text.map(c => ({ name: c.name, hex: c.hex })),
            background: tokens.colors.background.map(c => ({ name: c.name, hex: c.hex }))
        },
        spacing: tokens.spacing.map(s => ({
            name: s.name,
            value: s.itemSpacing,
            padding: s.padding
        })),
        effects: {
            shadows: tokens.effects.shadows.map(s => ({ name: s.name, value: s.value })),
            blurs: tokens.effects.blurs.map(b => ({ name: b.name, value: b.value }))
        }
    };

    const functions = [
        {
            name: "create_pseudo_component",
            description: "Generate a pseudo-XML component based on Figma component details",
            parameters: {
                type: "object",
                properties: {
                    componentName: {
                        type: "string",
                        description: "The name of the component"
                    },
                    pseudoCode: {
                        type: "string",
                        description: "The pseudo-XML code for the component"
                    }
                },
                required: ["componentName", "pseudoCode"]
            }
        }
    ];

    const prompt = `Design System Details:
${JSON.stringify(designSystem, null, 2)}

Component to Generate:
Name: ${component.name}
Type: ${component.type}
Description: ${component.description || 'No description provided'}
Size: ${instance.size.width}x${instance.size.height}
Styles: ${JSON.stringify(instance.styles || {})}

Requirements:
1. Generate pseudo-XML code that represents this component
2. Use semantic element names
3. Include basic styling attributes
4. Make it accessible
5. Keep it simple and readable
6. Use design system tokens where applicable

Example format:
<Button primary>
  <Icon name="star" />
  <Text>Click me</Text>
</Button>

Generate ONLY the pseudo-XML code without any additional explanation.`;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "user", content: prompt }],
            functions,
            function_call: { name: "create_pseudo_component" }
        });

        const response = JSON.parse(completion.choices[0].message.function_call.arguments);
        return response;
    } catch (error) {
        console.error(chalk.red(`Error generating pseudo component: ${error.message}`));
        return null;
    }
}

async function generatePseudoFrame(frame, components, tokens) {
    const functions = [
        {
            name: "create_pseudo_frame",
            description: "Generate a pseudo-XML frame layout based on Figma frame details",
            parameters: {
                type: "object",
                properties: {
                    frameName: {
                        type: "string",
                        description: "The name of the frame"
                    },
                    pseudoCode: {
                        type: "string",
                        description: "The pseudo-XML code for the frame layout"
                    }
                },
                required: ["frameName", "pseudoCode"]
            }
        }
    ];

    const prompt = `Frame Details:
Name: ${frame.name}
Size: ${frame.size.width}x${frame.size.height}
Layout: ${frame.layoutMode || 'FREE'}
Spacing: ${frame.itemSpacing}
Padding: ${JSON.stringify(frame.padding)}
Elements: ${frame.elements}

Available Components:
${components.map(c => `- ${c.name}`).join('\n')}

Requirements:
1. Generate pseudo-XML layout code for this frame
2. Use semantic container elements
3. Include layout attributes (flex, grid, etc.)
4. Use appropriate spacing and padding
5. Place components in a logical layout
6. Keep it simple and readable

Example format:
<Frame name="Header" layout="horizontal" spacing="24">
  <Logo />
  <Navigation layout="horizontal" spacing="16">
    <Link>Home</Link>
    <Link>About</Link>
  </Navigation>
  <Button primary>Sign Up</Button>
</Frame>

Generate ONLY the pseudo-XML code without any additional explanation.`;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "user", content: prompt }],
            functions,
            function_call: { name: "create_pseudo_frame" }
        });

        const response = JSON.parse(completion.choices[0].message.function_call.arguments);
        return response;
    } catch (error) {
        console.error(chalk.red(`Error generating pseudo frame: ${error.message}`));
        return null;
    }
}

async function generateAllPseudoCode(components, instances, frames, tokens) {
    console.log(chalk.green('\nGenerating Pseudo Components:'));
    const pseudoComponents = new Map();

    // Generate components first
    for (const component of components) {
        const componentInstances = instances.filter(i => i.componentId === component.id);
        if (componentInstances.length > 0) {
            const mainInstance = componentInstances[0];
            console.log(chalk.blue(`\nComponent: ${component.name}`));
            
            const pseudoComponent = await generatePseudoComponent(component, mainInstance, tokens);
            if (pseudoComponent) {
                pseudoComponents.set(component.id, pseudoComponent);
                console.log(chalk.white(pseudoComponent.pseudoCode));
            }
        }
    }

    console.log(chalk.green('\nGenerating Frame Layouts:'));
    const pseudoFrames = new Map();

    // Generate frames using the components
    for (const frame of frames) {
        console.log(chalk.blue(`\nFrame: ${frame.name}`));
        const pseudoFrame = await generatePseudoFrame(frame, components, tokens);
        if (pseudoFrame) {
            pseudoFrames.set(frame.id, pseudoFrame);
            console.log(chalk.white(pseudoFrame.pseudoCode));
        }
    }

    return { components: pseudoComponents, frames: pseudoFrames };
}

async function main() {
    try {
        const result = parseFigmaUrl(figmaUrl);
        console.log(chalk.green('\nFigma URL details:'));
        console.log(chalk.blue('Type:'), result.type);
        console.log(chalk.blue('File ID:'), result.fileId);
        console.log(chalk.blue('Title:'), result.title || 'Not specified');
        console.log(chalk.blue('Node ID:'), result.nodeId || 'Not specified');

        console.log(chalk.green('\nFetching file data from Figma API...'));
        const figmaData = await getFigmaFileData(result.fileId);
        
        console.log(chalk.green('\nFile Information:'));
        console.log(chalk.blue('Name:'), figmaData.name);
        console.log(chalk.blue('Last Modified:'), new Date(figmaData.lastModified).toLocaleString());

        console.log(chalk.green('\nProcessing design tokens...'));
        const tokens = processDesignTokens(figmaData.document);
        
        console.log(chalk.green('\nDesign Tokens Summary:'));
        console.log(chalk.blue('Total tokens found:'), formatTokenCount(tokens));

        // Print detailed token information
        printDetailedTokens(tokens);

        // Process and print canvas information
        const canvases = processCanvases(figmaData.document);
        printCanvasDetails(canvases);

        // Process and print component instances
        const instances = processComponentInstances(figmaData.document);
        printComponentInstances(instances);

        // Generate and print component structure as YAML
        console.log(chalk.green('\nCOMPONENT STRUCTURE:'));
        const componentYAML = generateComponentYAML(tokens.components, instances);
        console.log(chalk.white(componentYAML));

        // Generate pseudo components and frames
        const frames = canvases.flatMap(canvas => canvas.frames);
        const pseudoCode = await generateAllPseudoCode(tokens.components, instances, frames, tokens);
        
        // Add pseudo code to the output
        const outputPath = 'design-tokens.json';
        await fs.promises.writeFile(outputPath, JSON.stringify({
            tokens,
            canvases,
            instances,
            componentStructure: componentYAML,
            pseudoCode: {
                components: Object.fromEntries(pseudoCode.components),
                frames: Object.fromEntries(pseudoCode.frames)
            }
        }, null, 2));
        
        console.log(chalk.green(`\nAll information saved to ${outputPath}`));

    } catch (error) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
    }
}

main(); 