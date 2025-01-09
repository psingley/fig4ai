# fig4ai

![License](https://img.shields.io/badge/license-MIT-blue.svg)

A CLI tool that uses AI to generate design rules and documentation from your Figma files. It analyzes your Figma designs and automatically extracts design tokens, components, and layout information into a structured format.

## Features

- 🎨 Extract design tokens (colors, typography, spacing, effects)
- 🧩 Generate component documentation
- 📐 Analyze layout structures
- 🤖 AI-powered pseudo-code generation
- 🔄 Real-time progress indicators
- 📝 Markdown output format

## Run
Run directly with npx:

```bash
npx fig4ai <figma-url>
```

## IDE Integration

After generating your `.designrules` file, you can use it with AI-powered IDEs to automatically generate code and configurations:

### Cursor, Windsurf, VS Code

Simply mention the `.designrules` file in your prompts:

```
> Generate a Tailwind config based on @.designrules file
```
```
> Create a Vue login page using the design tokens from @.designrules
```
```
> Build a React component library following @.designrules specifications
```


The AI will analyze your `.designrules` file and generate code that matches your design system's:
- Color palette
- Typography scales
- Spacing system
- Component structures
- Layout patterns
- Shadow effects
- Border styles
- And more...

## Usage

### Command Line

```bash
npx fig4ai <figma-url>
```

Or if you've set `FIGMA_DESIGN_URL` in your `.env` file:

```bash
npx fig4ai
```

### Output

The tool generates a `.designrules` file containing:

- Design token documentation
- Component specifications
- Layout structures
- AI-generated pseudo-code
- Style references
- Accessibility considerations

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues or have questions, please:
1. Check the [issues page](https://github.com/f/fig4ai/issues)
2. Create a new issue if your problem isn't already listed
