import fetch from 'node-fetch';

export async function getFigmaFileData(fileId) {
    const response = await fetch(`https://api.figma.com/v1/files/${fileId}`, {
        headers: {
            'X-Figma-Token': process.env.FIGMA_ACCESS_TOKEN
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch Figma file: ${response.statusText}`);
    }

    return response.json();
}

export async function getFigmaImage(fileId, nodeId) {
    // Clean up the file ID (remove any 'design/' prefix)
    const cleanFileId = fileId.replace('design/', '');
    
    // First, get the image URL from Figma
    const response = await fetch(`https://api.figma.com/v1/images/${cleanFileId}?ids=${nodeId}`, {
        headers: {
            'X-Figma-Token': process.env.FIGMA_ACCESS_TOKEN
        }
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Failed to get image URL: ${response.statusText}${errorData.err ? ` - ${errorData.err}` : ''}`);
    }

    const data = await response.json();
    const imageUrl = data.images[nodeId];

    if (!imageUrl) {
        throw new Error(`No image URL found for node: ${nodeId}`);
    }

    // Return the URL - the consumer can decide whether to download it or use the URL directly
    return {
        url: imageUrl,
        ref: nodeId
    };
}

// Add a new function to get node images
export async function getFigmaNodeImages(fileId, nodeIds) {
    const cleanFileId = fileId.replace('design/', '');
    const nodeIdsParam = nodeIds.join(',');
    
    const response = await fetch(`https://api.figma.com/v1/files/${cleanFileId}/nodes?ids=${nodeIdsParam}`, {
        headers: {
            'X-Figma-Token': process.env.FIGMA_ACCESS_TOKEN
        }
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Failed to get nodes: ${response.statusText}${errorData.err ? ` - ${errorData.err}` : ''}`);
    }

    const data = await response.json();
    return data;
} 