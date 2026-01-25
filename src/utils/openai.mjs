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
}
