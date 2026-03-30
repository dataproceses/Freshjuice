
import { GoogleGenAI } from "@google/genai";
import { Product, CartItem } from "../types";

// Always use the direct process.env.API_KEY for initialization as per guidelines
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const geminiService = {
  // 1. AI Juice Descriptions - Enhanced to 2-3 sentences
  async generateJuiceDescription(juiceName: string, ingredients: string[]): Promise<string> {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Write a detailed and highly appetizing 2-3 sentence description for a fresh juice named "${juiceName}". 
        The ingredients are: ${ingredients.join(', ')}. 
        Highlight the vibrant flavor profile, the refreshing texture, and the specific health benefits of these ingredients. 
        Keep the tone premium and energetic.`,
      });
      return response.text?.trim() || "Freshly squeezed daily just for you.";
    } catch (error) {
      console.error("Gemini Error:", error);
      return "A deliciously fresh and nutrient-packed juice made with the finest organic ingredients.";
    }
  },

  // 2. AI Customer Chatbot
  async getChatResponse(query: string): Promise<string> {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: query,
        config: {
          systemInstruction: `You are a friendly juice shop assistant at FreshPress. 
          Store hours: 8am-8pm. Location: 123 Juice Street. 
          Delivery fee: $3.50. We only use raw, organic fruits. 
          Be cheerful and keep answers under 2 sentences.`,
        }
      });
      return response.text || "I'm here to help! What would you like to know?";
    } catch (error) {
      return "FreshPress is juicing some new ideas! Please ask again in a second.";
    }
  },

  // 3. AI Upsell Suggestions
  async getUpsellSuggestion(cartItems: CartItem[], allProducts: Product[]): Promise<Product | null> {
    if (cartItems.length === 0) return null;
    try {
      const cartNames = cartItems.map(i => i.name).join(', ');
      const availableNames = allProducts.map(p => p.name).join(', ');
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Cart: [${cartNames}]. Available: [${availableNames}]. Pick exactly one juice name from 'Available' that pairs best. Respond with ONLY the juice name.`,
      });

      const suggestedName = response.text?.trim() || "";
      return allProducts.find(p => p.name.toLowerCase().includes(suggestedName.toLowerCase())) || null;
    } catch (error) {
      return null;
    }
  },

  // 4. AI Order Confirmation
  async generateConfirmationMessage(name: string): Promise<string> {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Generate a fun, 1-sentence juice-themed order confirmation for ${name}.`,
      });
      return response.text || "Your fresh squeeze is being prepared!";
    } catch (error) {
      return "Thanks for your order! We're starting on it now.";
    }
  }
};
