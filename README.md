# Figtell

A simple CLI tool to parse and display Figma URLs in a readable format, with Figma API integration.

## Setup

1. Create a `.env` file in the root directory
2. Add your Figma access token:
```
FIGMA_ACCESS_TOKEN=your_access_token_here
```

To get your Figma access token:
1. Log in to Figma
2. Go to Settings > Account > Personal access tokens
3. Click "Generate new token"
4. Copy the token and paste it in your `.env` file

## Usage

You can run this tool directly using npx:

```bash
npx figtell <figma-url>
```

Example:
```bash
npx figtell https://www.figma.com/file/abcd1234/MyDesign?node-id=1%3A2
```

This will output:
- URL parsing details (type, file ID, node ID, etc.)
- File information from Figma API (name, last modified, version, etc.)
- Node information (if node ID is provided)

## Installation

If you want to install it globally:

```bash
npm install -g figtell
```

Then you can use it directly:

```bash
figtell <figma-url>
```

## License

MIT 