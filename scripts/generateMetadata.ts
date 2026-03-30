import * as fs from "fs";
import * as path from "path";
import {fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IMAGE_CID = "bafkreiam7uy6pwtswrsaj3jabaz4iewxfmnurok2oorxmhcj6hoe3fuwoe";
const OUTPUT_DIR = path.join(__dirname, "../nft-metadata");

// Create output folder if it doesn't exist
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

for (let i = 1; i <= 100; i++) {
  const metadata = {
    name: `XylemNFT #${i}`,
    description: "A XylemNFT on Robinhood Chain. Enter the Matrix.",
    image: `ipfs://${IMAGE_CID}`,
    version: "2",
    attributes: [
      { trait_type: "Collection", value: "XylemNFT" },
      { trait_type: "Network", value: "Robinhood Chain" },
      { trait_type: "Token ID", value: i }
    ]
  };

  const filePath = path.join(OUTPUT_DIR, `${i}`);
  fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));
  console.log(`Generated metadata for token #${i}`);
}

console.log(`\nDone! ${100} metadata files saved to /nft-metadata`);
