import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export class OpenAIUtil {
    static async generateEnrichments({ title, description, url }) {
        const inputText = `
            Title: ${title}
            Description: ${description}
            URL: ${url}
        
            Return a JSON object with a single field "enrichments": a list of semantic categories the content belongs to that will be used for search enhancements.
            There should be a maximum of 5 enrichments strings. Exclude overly generic categories like "Social Media".
            If nothing of value can be inferred, return an empty array.
            No explanations.
        `;
      
        try {
            const response = await client.responses.create({
                model: "gpt-4o-mini",
                input: inputText,
                text: {
                    format: {
                        type: "json_schema",
                        strict: true,
                        name: "enrichment_schema",
                        schema: {
                            type: "object",
                            properties: {
                                enrichments: {
                                    type: "array",
                                    items: { type: "string" }
                                }
                            },
                            required: ["enrichments"],
                            additionalProperties: false
                        }
                    }
                }
            });
              
            console.log('OpenAI response:', response);
            const parsed = JSON.parse(response?.output_text || "{}");
            return parsed.enrichments || []; // → ["restaurant", "steakhouse", "food"]
        } catch (error) {
            console.error('Error generating enrichments:', error);
            return [];
        }
    }

    /**
     * Determine if a save is "broken" (e.g. missing/invalid content, unreachable, or low quality).
     * Returns only { isBroken: true } or { isBroken: false }. On any error, returns { isBroken: true }.
     * Presence or absence of an image is included as a signal.
     */
    static async detectBrokenSave({ title, description, url, image }) {
        try {
            const titleStr = title != null ? String(title).trim() : '';
            const descStr = description != null ? String(description).trim() : '';
            const urlStr = url != null ? String(url).trim() : '';
            const imageStr = image != null && typeof image === 'string' ? String(image).trim() : '';
            const inputText = `
                Title: ${titleStr || '(none)'}
                Description: ${descStr || '(none)'}
                URL: ${urlStr || '(none)'}
                Image: ${imageStr ? imageStr : '(none)'}

                Determine if this save is "broken": e.g. missing or invalid URL, no usable title, no image when one would be expected, or content that cannot be meaningfully used for search or display.
                That could include things like login blockers or paywalls, or a title/description that indicates we were rate-limited, etc. These are just examples. 
                Return a JSON object with a single boolean field "isBroken": true if broken, false otherwise.
                No explanations.
            `.trim();
            const response = await client.responses.create({
                model: "gpt-4o-mini",
                input: inputText,
                text: {
                    format: {
                        type: "json_schema",
                        strict: true,
                        name: "broken_schema",
                        schema: {
                            type: "object",
                            properties: {
                                isBroken: { type: "boolean" }
                            },
                            required: ["isBroken"],
                            additionalProperties: false
                        }
                    }
                }
            });
            const parsed = JSON.parse(response?.output_text || "{}");
            const isBroken = parsed.isBroken === true;
            return { isBroken };
        } catch (error) {
            console.error('Error in detectBrokenSave:', error);
            return { isBroken: false };
        }
    }
}
