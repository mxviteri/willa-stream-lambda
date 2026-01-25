import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export class OpenAI {
    static async generateEnrichments({ title, description, url }) {
        const inputText = `
            Title: ${title}
            Description: ${description}
            URL: ${url}
        
            Return a JSON object with a single field "enrichments": a list of semantic categories the content belongs to that will be used for search enhancements.
            If nothing of value can be inferred, return an empty array.
            No explanations.
        `;
      
        try {
            const response = await client.responses.create({
                model: "gpt-4.1-mini",   // perfect for this task, cheap + accurate
                input: inputText,
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: "enrichment_schema",
                        strict: true,
                        schema: {
                            type: "object",
                            properties: {
                                enrichments: {
                                    type: "array",
                                    items: { type: "string" }
                                }
                            },
                            required: ["enrichments"],
                        },
                    },
                },
            });
          
            return response.output[0].enrichments;  // → ["restaurant", "steakhouse", "food"]
        } catch (error) {
            console.error('Error generating enrichments:', error);
            return [];
        }
    }
}
