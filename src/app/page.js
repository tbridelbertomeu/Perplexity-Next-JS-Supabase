'use client';
'use strict';

// 1. Import required dependencies
import React, { useEffect, useRef, useState, memo } from 'react';
import {
  ArrowCircleRight,
  ChatCenteredDots,
  Stack,
  GitBranch,
} from '@phosphor-icons/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createClient } from '@supabase/supabase-js';

// 2. Initialize Supabase client
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_API_KEY = process.env.NEXT_PUBLIC_SUPABASE_API_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_API_KEY);

// 3. Home component
export default function Home() {
  // 4. Initialize states and refs
  const messagesEndRef = useRef(null);
  const [inputValue, setInputValue] = useState('');
  const [messageHistory, setMessageHistory] = useState([]);

  // 5. Auto-scroll to last message
  useEffect(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 0);
  }, [messageHistory]);

  // 6. Fetch message history from Supabase
  useEffect(() => {
    // Handle new inserts or updates into the table
    const handleRealtimeUpdates = (payload) => {
      setMessageHistory((prevMessages) => {
        const lastMessage = prevMessages[prevMessages.length - 1];
        const isSameType =
          lastMessage?.payload?.type === 'GPT' &&
          payload.new.payload.type === 'GPT';

        return isSameType
          ? [...prevMessages.slice(0, -1), payload.new]
          : [...prevMessages, payload.new];
      });
    };

    // Subscribe to Supabase channel for real-time updates
    const channel = supabase
      .channel('message_history_channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_history' },
        handleRealtimeUpdates
      )
      .subscribe();

    // Fetch existing message history from Supabase
    supabase
      .from('message_history')
      .select('*')
      .order('created_at', { ascending: true })
      .then(({ data: message_history, error }) =>
        error ? console.log('error', error) : setMessageHistory(message_history)
      );

    // Cleanup function to unsubscribe
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 10. Function to send a message
  const sendMessage = (messageToSend) => {
    const message = messageToSend || inputValue;
    const body = JSON.stringify({ message });
    setInputValue('');

    // 11. POST message to the backend
    fetch('/api/backend', {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
      },
    })
      .then((res) => res.json())
      .then((data) => {
        console.log('data', data);
      })
      .catch((err) => console.log('err', err));
  };

  // 12. Render home component
  return (
    <div className="flex h-screen">
      {/* 13. Create main container with flex and screen height */}
      <div className="flex-grow h-screen flex flex-col justify-between mx-auto max-w-4xl">
        {/* 14. Map over message history to display each message */}
        {messageHistory.map((message, index) => (
          <MessageHandler
            key={index}
            message={message.payload}
            sendMessage={sendMessage}
          />
        ))}
        {/* 15. Include InputArea for message input and sending */}
        <InputArea
          inputValue={inputValue}
          setInputValue={setInputValue}
          sendMessage={sendMessage}
        />
        {/* 16. Add a ref for the end of messages to enable auto-scroll */}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

/* 17. Export InputArea component */
export function InputArea({ inputValue, setInputValue, sendMessage }) {
  /* 18. Render input and send button */
  return (
    <div className="flex items-center py-3">
      {/* 19. Create input box for message */}
      <input
        type="text"
        className="flex-1 p-2 border rounded-l-md focus:outline-none focus:border-blue-500"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
      />
      {/* 20. Create send button */}
      <button
        onClick={() => sendMessage()}
        className="bg-blue-500 text-white p-2 rounded-r-md hover:bg-blue-600"
      >
        <ArrowCircleRight size={25} />
      </button>
    </div>
  );
}

/* 21. Query component for displaying content */
export const Query = ({ content }) => {
  return <div className="text-3xl font-bold my-4 w-full">{content}</div>;
};

/* 22. Sources component for displaying list of sources */
export const Sources = ({ content }) => {
  // 23. Truncate text to a given length
  const truncateText = (text, maxLength) =>
    text.length <= maxLength ? text : `${text.substring(0, maxLength)}...`;

  // 24. Extract site name from a URL
  const extractSiteName = (url) => new URL(url).hostname.replace('www.', '');

  return (
    // 25. Render the Sources component
    <>
      <div className="text-3xl font-bold my-4 w-full flex">
        <GitBranch size={32} />
        <span className="px-2">Sources</span>
      </div>
      <div className="flex flex-wrap">
        {
          // 26. Map over the content array to create source tiles
          content?.map(({ title, link }, index) => (
            <a key={index} href={link} className="w-1/4 p-1">
              <span className="flex flex-col items-center py-2 px-6 bg-white rounded shadow hover:shadow-lg transition-shadow duration-300 tile-animation h-full">
                <span>{truncateText(title, 40)}</span>
                <span>{extractSiteName(link)}</span>
              </span>
            </a>
          ))
        }
      </div>
    </>
  );
};

// 27. VectorCreation component for displaying a brief message
export const VectorCreation = ({ content }) => {
  // 28. Initialize state to control visibility of the component
  const [visible, setVisible] = useState(true);

  // 29. Use useEffect to handle the visibility timer
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  return visible ? (
    <div className="w-full p-1">
      <span className="flex flex-col items-center py-2 px-6 bg-white rounded shadow hover:shadow-lg transition-shadow duration-300 h-full tile-animation">
        <span>{content}</span>
      </span>
    </div>
  ) : null;
};

// 28. Heading component for displaying various headings
export const Heading = ({ content }) => {
  return (
    <div className="text-3xl font-bold my-4 w-full flex">
      <ChatCenteredDots size={32} />
      <span className="px-2">{content}</span>
    </div>
  );
};

// 30. GPT component for rendering markdown content
const GPT = ({ content }) => (
  <ReactMarkdown
    className="prose mt-1 w-full break-words prose-p:leading-relaxed"
    remarkPlugins={[remarkGfm]}
    components={{
      a: ({ node, ...props }) => (
        <a {...props} style={{ color: 'blue', fontWeight: 'bold' }} />
      ),
    }}
  >
    {content}
  </ReactMarkdown>
);

// 31. FollowUp component for displaying follow-up options
export const FollowUp = ({ content, sendMessage }) => {
  // 32. State for storing parsed follow-up options
  const [followUp, setFollowUp] = useState([]);

  // 33. useRef for scrolling
  const messagesEndReff = useRef(null);

  // 34. Scroll into view when followUp changes
  useEffect(() => {
    setTimeout(() => {
      messagesEndReff.current?.scrollIntoView({ behavior: 'smooth' });
    }, 0);
  }, [followUp]);

  // 35. Parse JSON content to extract follow-up options
  useEffect(() => {
    if (content[0] === '{' && content[content.length - 1] === '}') {
      try {
        const parsed = JSON.parse(content);
        setFollowUp(parsed.follow_up || []);
      } catch (error) {
        console.log('error parsing json', error);
      }
    }
  }, [content]);

  // 36. Handle follow-up click event
  const handleFollowUpClick = (text, e) => {
    e.preventDefault();
    sendMessage(text);
  };

  // 37. Render the FollowUp component
  return (
    <>
      {followUp.length > 0 && (
        <div className="text-3xl font-bold my-4 w-full flex">
          <Stack size={32} /> <span className="px-2">Follow-Up</span>
        </div>
      )}
      {/* 38. Map over follow-up options */}
      {followUp.map((text, index) => (
        <a
          href="#"
          key={index}
          className="text-xl w-full p-1"
          onClick={(e) => handleFollowUpClick(text, e)}
        >
          <span>{text}</span>
        </a>
      ))}
      {/* 39. Scroll anchor */}
      <div ref={messagesEndReff} />
    </>
  );
};

// 40. MessageHandler component for dynamically rendering message components
const MessageHandler = memo(({ message, sendMessage }) => {
  // 41. Map message types to components
  const COMPONENT_MAP = {
    Query,
    Sources,
    VectorCreation,
    Heading,
    GPT,
    FollowUp,
  };

  // 42. Determine which component to render based on message type
  const Component = COMPONENT_MAP[message.type];
  return Component ? (
    <Component content={message.content} sendMessage={sendMessage} />
  ) : null;
});
