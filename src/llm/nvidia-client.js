import axios from 'axios';
import config from '../utils/config.js';

/**
 * NVIDIA NIM LLM Client for GenAgent
 */
class NVIDIAClient {
  constructor() {
    this.apiUrl = config.llm.api_url;
    this.model = config.llm.model;
    this.apiKey = config.llm.api_key;
    this.defaultParams = {
      model: this.model,
      max_tokens: config.llm.max_tokens,
      temperature: config.llm.temperature,
      top_p: config.llm.top_p,
      stream: config.llm.stream
    };
  }

  /**
   * Get headers for API requests
   */
  getHeaders(stream = true) {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Accept': stream ? 'text/event-stream' : 'application/json',
      'Content-Type': 'application/json'
    };
  }

  /**
   * Send message to LLM
   */
  async sendMessage(message, history = [], stream = config.llm.stream) {
    try {
      const payload = {
        ...this.defaultParams,
        messages: [
          ...history,
          { role: 'user', content: message }
        ],
        stream: stream
      };

      const response = await axios.post(this.apiUrl, payload, {
        headers: this.getHeaders(stream),
        responseType: stream ? 'stream' : 'json'
      });

      return response;
    } catch (error) {
      console.error('NVIDIA API Error:', error.response?.data || error.message);
      throw new Error(`NVIDIA API request failed: ${error.message}`);
    }
  }

  /**
   * Stream response from LLM
   */
  async* streamMessage(message, history = []) {
    try {
      const payload = {
        ...this.defaultParams,
        messages: [
          ...history,
          { role: 'user', content: message }
        ],
        stream: true
      };

      const response = await axios.post(this.apiUrl, payload, {
        headers: this.getHeaders(true),
        responseType: 'stream'
      });

      let buffer = '';

      for await (const chunk of response.data) {
        const chunkStr = chunk.toString();
        buffer += chunkStr;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              return;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.choices && parsed.choices[0]?.delta?.content) {
                yield parsed.choices[0].delta.content;
              }
            } catch (e) {
              // Skip malformed data
            }
          }
        }
      }
    } catch (error) {
      console.error('Streaming error:', error);
      throw new Error(`Stream failed: ${error.message}`);
    }
  }

  /**
   * Get complete (non-streaming) response
   */
  async getCompleteResponse(message, history = []) {
    const response = await this.sendMessage(message, history, false);
    return response.data.choices[0]?.message?.content || '';
  }

  /**
   * Test connection to NVIDIA API
   */
  async testConnection() {
    try {
      const response = await this.getCompleteResponse('Hello, respond with "OK" if you receive this.');
      return response.toLowerCase().includes('ok');
    } catch (error) {
      console.error('Connection test failed:', error.message);
      return false;
    }
  }
}

export const nvidiaClient = new NVIDIAClient();
export default nvidiaClient;