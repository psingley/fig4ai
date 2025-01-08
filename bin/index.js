#!/usr/bin/env node

import chalk from 'chalk';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

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

        // Optional: Save tokens to a file
        const outputPath = 'design-tokens.json';
        await fs.promises.writeFile(outputPath, JSON.stringify(tokens, null, 2));
        console.log(chalk.green(`\nTokens saved to ${outputPath}`));

    } catch (error) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
    }
}

main(); 