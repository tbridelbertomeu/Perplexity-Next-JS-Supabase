import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { BraveSearch } from 'langchain/tools';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { db } from '@/db/index'; // Adjust the import path based on your project structure
import { webpageEmbeddings } from '@/db/schema';
import { eq } from 'drizzle-orm';

// Initialize OpenAI and Supabase clients
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const embeddings = new OpenAIEmbeddings();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_API_KEY
);

// Send payload to Supabase table
async function sendPayload(content) {
  try {
    const { data, error } = await supabase
      .from('message_history')
      .insert([{ payload: content }])
      .select('id');

    if (error) throw error;

    return data[0].id;
  } catch (error) {
    console.error('Error sending payload:', error);
    throw error;
  }
}

// Rephrase input using GPT
async function rephraseInput(inputString) {
  const gptAnswer = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content:
          'You are a rephraser and always respond with a rephrased version of the input that is given to a search engine API. Always be succinct and use the same words as the input.',
      },
      { role: 'user', content: inputString },
    ],
  });
  return gptAnswer.choices[0].message.content;
}

// Search engine for sources
async function searchEngineForSources(message, embeddingSource) {
  if (embeddingSource === 'database') {
    // Fetch embeddings from the PostgreSQL database
    const websiteId = parseInt(process.env.WEBSITE_ID, 10);

    // Compute the embedding for the user's query
    const queryEmbeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small', // Use an appropriate embedding model
      input: message,
    });
    const queryEmbedding = queryEmbeddingResponse.data[0].embedding;

    // Retrieve embeddings from the database
    const embeddingsData = await db
      .select()
      .from(webpageEmbeddings)
      .where(eq(webpageEmbeddings.websiteId, websiteId));

    // Extract embeddings and associated content
    const documents = embeddingsData.map((row) => {
      const embeddingArray =
        typeof row.embedding === 'string'
          ? row.embedding.replace(/[{}]/g, '').split(',').map(Number)
          : row.embedding;
      return {
        embedding: embeddingArray,
        content: row.content,
        url: row.url,
      };
    });

    // Compute similarities
    const similarities = documents.map((doc) => ({
      content: doc.content,
      url: doc.url,
      similarity: cosineSimilarity(queryEmbedding, doc.embedding),
    }));

    // Sort by similarity in descending order
    similarities.sort((a, b) => b.similarity - a.similarity);

    // Print the list of documents with associated scores
    console.log('Documents with similarity scores:');
    similarities.forEach((doc, index) => {
      console.log(
        `${index + 1}. Score: ${doc.similarity.toFixed(4)}, URL: ${doc.url}`
      );
      console.log(`   Content: ${doc.content.substring(0, 100)}...`);
    });

    // Select top N documents (e.g., top 4)
    const topDocuments = similarities.slice(0, 4);

    // Prepare context for LLM
    const contextText = topDocuments.map((doc) => doc.content).join('\n\n');

    // Send 'Sources' payload to frontend with content and link
    const sourcesPayload = topDocuments.map((doc) => ({
      title: doc.content,
      link: doc.url,
    }));
    await sendPayload({ type: 'Sources', content: sourcesPayload });

    // Send a payload message indicating the vector creation process is complete
    await sendPayload({
      type: 'VectorCreation',
      content: `Finished Retrieving Embeddings from Database.`,
    });

    // Trigger LLM with context and query
    await triggerLLMAndFollowup(`Context: ${contextText}\n\nQuery: ${message}`);
  } else {
    // Fetch embeddings from internet pages as usual
    const loader = new BraveSearch({
      apiKey: process.env.BRAVE_SEARCH_API_KEY,
    });
    const rephrasedMessage = await rephraseInput(message);
    const docs = await loader.call(rephrasedMessage);

    // Normalize data
    function normalizeData(docs) {
      return JSON.parse(docs)
        .filter(
          (doc) => doc.title && doc.link && !doc.link.includes('brave.com')
        )
        .slice(0, 4)
        .map(({ title, link }) => ({ title, link }));
    }
    const normalizedData = normalizeData(docs);

    // Send normalized data as payload
    await sendPayload({ type: 'Sources', content: normalizedData });

    // Initialize vectorCount
    let vectorCount = 0;

    // Initialize async function for processing each search result item
    const fetchAndProcess = async (item) => {
      try {
        // Create a timer for the fetch promise
        const timer = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 5000)
        );

        // Fetch the content of the page
        const fetchPromise = fetchPageContent(item.link);

        // Wait for either the fetch promise or the timer
        const htmlContent = await Promise.race([timer, fetchPromise]);

        // Check for insufficient content length
        if (htmlContent.length < 250) return null;

        // Split the text into chunks
        const splitText = await new RecursiveCharacterTextSplitter({
          chunkSize: 200,
          chunkOverlap: 0,
        }).splitText(htmlContent);

        // Create a vector store from the split text
        const vectorStore = await MemoryVectorStore.fromTexts(
          splitText,
          { annotationPosition: item.link },
          embeddings
        );

        // Increment the vector count
        vectorCount++;

        // Perform similarity search on the vectors
        return await vectorStore.similaritySearch(message, 1);
      } catch (error) {
        // Log any error and increment the vector count
        console.log(
          `Failed to fetch content for ${item.link}, error: ${error.message}`
        );
        vectorCount++;
        return null;
      }
    };

    // Wait for all fetch and process promises to complete
    const results = await Promise.all(normalizedData.map(fetchAndProcess));

    // Make sure that vectorCount reaches at least 4
    while (vectorCount < 4) {
      vectorCount++;
    }

    // Filter out unsuccessful results
    const successfulResults = results.filter((result) => result !== null);

    // Get top 4 results if there are more than 4, otherwise get all
    const topResult =
      successfulResults.length > 4
        ? successfulResults.slice(0, 4)
        : successfulResults;

    // Send a payload message indicating the vector creation process is complete
    await sendPayload({
      type: 'VectorCreation',
      content: `Finished Scanning Sources.`,
    });

    // Trigger any remaining logic and follow-up actions
    await triggerLLMAndFollowup(
      `Query: ${message}, Top Results: ${JSON.stringify(topResult)}`
    );
  }
}

// Function to compute cosine similarity
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, a, idx) => sum + a * vecB[idx], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

// Define fetchPageContent function
async function fetchPageContent(link) {
  try {
    const response = await fetch(link, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });
    const html = await response.text();
    return extractMainContent(html);
  } catch (error) {
    console.error(`Error fetching ${link}: ${error.message}`);
    throw error;
  }
}

// Define extractMainContent function
function extractMainContent(html) {
  const $ = cheerio.load(html);
  $('script, style, head, nav, footer, iframe, img').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

// Define triggerLLMAndFollowup function
async function triggerLLMAndFollowup(inputString) {
  // Call getGPTResults with inputString
  await getGPTResults(inputString);

  // Generate follow-up with generateFollowup
  const followUpResult = await generateFollowup(inputString);

  // Send follow-up payload
  await sendPayload({ type: 'FollowUp', content: followUpResult });

  // Return JSON response
  return NextResponse.json({ message: 'Processing request' });
}

// Define getGPTResults function
const getGPTResults = async (inputString) => {
  // Initialize accumulatedContent
  let accumulatedContent = '';

  // Open a streaming connection with OpenAI
  const stream = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content:
          'You are an assistant that provides answers to user queries based EXCLUSIVELY on the provided context. You are STRICTLY FORBIDDEN from using any information from your training data or external knowledge. Use ONLY the given context to generate accurate and helpful responses. If the context does not contain sufficient information to answer the query, state that you cannot provide an answer based on the given context.',
      },
      {
        role: 'user',
        content: inputString, // Contains both context and query
      },
    ],
    stream: true,
  });

  // Create an initial row in the database
  let rowId = await createRowForGPTResponse();

  // Send initial payload
  await sendPayload({ type: 'Heading', content: 'Answer' });

  // Iterate through the response stream
  for await (const part of stream) {
    // Check if delta content exists
    if (part.choices[0]?.delta?.content) {
      // Accumulate the content
      accumulatedContent += part.choices[0]?.delta?.content;

      // Update the row with new content
      await updateRowWithGPTResponse(rowId, accumulatedContent);
    }
  }
};

// Define createRowForGPTResponse function
const createRowForGPTResponse = async () => {
  // Generate a unique stream ID
  const generateUniqueStreamId = () => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  // Create the payload
  const payload = { type: 'GPT', content: '' };

  // Insert into database
  const { data, error } = await supabase
    .from('message_history')
    .insert([{ payload }])
    .select('id');

  if (error) {
    console.error('Error creating row for GPT response:', error);
    throw error;
  }

  // Return the ID and stream ID
  return data ? data[0].id : null;
};

// Define updateRowWithGPTResponse function
const updateRowWithGPTResponse = async (rowId, content) => {
  if (!rowId) {
    console.error('Invalid rowId provided to updateRowWithGPTResponse');
    return null;
  }

  // Create the payload
  const payload = { type: 'GPT', content: content };

  try {
    // Update the existing row instead of deleting and reinserting
    const { data, error } = await supabase
      .from('message_history')
      .update({ payload })
      .eq('id', rowId)
      .select('id');

    if (error) throw error;

    // Return the updated row ID
    return data ? data[0].id : null;
  } catch (error) {
    console.error('Error updating row with GPT response:', error);
    throw error;
  }
};

// Define generateFollowup function
async function generateFollowup(message) {
  // Create chat completion with OpenAI API
  const chatCompletion = await openai.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: `You are a follow up answer generator and always respond with 4 follow up questions based on this input "${message}" in JSON format. i.e. { "follow_up": ["QUESTION_GOES_HERE", "QUESTION_GOES_HERE", "QUESTION_GOES_HERE", "QUESTION_GOES_HERE"] }`,
      },
      {
        role: 'user',
        content: `Generate 4 follow up questions based on this input "${message}"`,
      },
    ],
    model: 'gpt-4',
  });

  // Return the content of the chat completion
  return chatCompletion.choices[0].message.content;
}

// Define POST function for API endpoint
export async function POST(req) {
  try {
    // Get message from request payload
    const { message, embeddingSource } = await req.json();

    // Send query payload
    await sendPayload({ type: 'Query', content: message });

    // Start the search engine to find sources based on the query
    await searchEngineForSources(message, embeddingSource);

    // Return a response to the client
    return NextResponse.json({ message: 'Processing request' });
  } catch (error) {
    console.error('Error processing request:', error);
    return NextResponse.json(
      { error: 'An error occurred while processing the request' },
      { status: 500 }
    );
  }
}
