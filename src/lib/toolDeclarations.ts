import { Type, FunctionDeclaration } from '@google/genai';

export const googleTools: FunctionDeclaration[] = [
  {
    name: "list_gmail_messages",
    description: "Read or search emails from the user's Gmail. Returns subject, sender, date, and preview for each message. The user asking IS permission — call this immediately when they ask about their emails.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        maxResults: {
          type: Type.NUMBER,
          description: "Number of emails to fetch. Maximum 5."
        },
        query: {
          type: Type.STRING,
          description: "Optional Gmail search query (e.g., 'in:inbox', 'from:alice', 'subject:meeting'). Defaults to 'in:inbox'."
        }
      }
    }
  },
  {
    name: "list_calendar_events",
    description: "List upcoming events from the user's primary Google Calendar. The user asking IS permission — call this immediately when they ask about their schedule or events.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        timeMin: {
          type: Type.STRING,
          description: "RFC3339 timestamp. Defaults to now."
        },
        _confirmed: {
          type: Type.BOOLEAN,
          description: "True only after user explicitly confirmed calendar access."
        }
      }
    }
  },
  {
    name: "list_google_tasks",
    description: "List the user's pending tasks from their primary Google Tasks list. The user asking IS permission — call this immediately when they ask about their tasks.",
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: "get_user_location",
    description: "Get the user's current geographic location using the browser geolocation API. Returns latitude, longitude, accuracy, timezone, local time, and UTC offset. Call this when you need to know the user's location for weather, nearby places, local time, timezone, or any location-specific context. This is especially important for the initial greeting to personalize the conversation based on the user's actual local time and timezone.",
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: "search_youtube",
    description: "Search for videos on YouTube based on a query.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        q: {
          type: Type.STRING,
          description: "The search query."
        }
      },
      required: ["q"]
    }
  },
  {
    name: "web_glance",
    description: "Search public web snippets for a short topic. Use for public, non-private topics, including quiet idle reading. Do not use it for private user data.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "The public topic or question to look up."
        },
        maxResults: {
          type: Type.NUMBER,
          description: "Number of short results to return. Maximum 5."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "playwright_action",
    description: "Run a bounded Playwright browser automation job on the backend. Use this to open webpages, interact with UI elements (clicking, typing, selecting), extract text, and verify page states. Use 'steps' for multi-step workflows (e.g., navigate to login -> fill username -> fill password -> click submit).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: "Initial http/https URL to open, e.g. http://localhost:3000 or https://example.com."
        },
        action: {
          type: Type.STRING,
          description: "Single action when steps is not used: navigate, click, fill, type, press, select_option, wait_for_selector, wait, extract_text, screenshot, snapshot."
        },
        selector: {
          type: Type.STRING,
          description: "Precise CSS selector for the target element (e.g. 'button#submit', 'input[name=\"q\"]')."
        },
        value: {
          type: Type.STRING,
          description: "The value to fill into a field, select from a dropdown, or milliseconds to wait for wait actions."
        },
        text: {
          type: Type.STRING,
          description: "Alternative text value for fill/type actions."
        },
        key: {
          type: Type.STRING,
          description: "Keyboard key to press, e.g. 'Enter', 'Tab', 'Escape'."
        },
        screenshot: {
          type: Type.BOOLEAN,
          description: "Whether to capture a visual screenshot after the actions."
        },
        fullPage: {
          type: Type.BOOLEAN,
          description: "Whether screenshots should capture the entire scrollable page."
        },
        timeoutMs: {
          type: Type.NUMBER,
          description: "Per-action timeout in milliseconds. Maximum 15000."
        },
        steps: {
          type: Type.ARRAY,
          description: "Ordered sequence of browser actions to execute in a single session. Ideal for complex workflows like filling forms or navigating deep into a site.",
          items: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING, description: "navigate, click, fill, type, press, select_option, wait_for_selector, wait, extract_text, screenshot, snapshot." },
              url: { type: Type.STRING, description: "URL for navigate." },
              selector: { type: Type.STRING, description: "CSS selector for selector-based actions." },
              value: { type: Type.STRING, description: "Value for fill/type/select/wait." },
              text: { type: Type.STRING, description: "Alternative value for fill/type." },
              key: { type: Type.STRING, description: "Keyboard key for press." },
              timeoutMs: { type: Type.NUMBER, description: "Step timeout in milliseconds." },
              waitUntil: { type: Type.STRING, description: "Navigation wait strategy: load, domcontentloaded, networkidle, or commit." },
              state: { type: Type.STRING, description: "Selector wait state: attached, detached, visible, or hidden." },
              fullPage: { type: Type.BOOLEAN, description: "Full-page screenshot for screenshot steps." }
            },
            required: ["action"]
          }
        }
      }
    }
  },
  {
    name: "create_google_task",
    description: "Create a new task in the user's primary Google Tasks list.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: "The title of the task."
        },
        notes: {
          type: Type.STRING,
          description: "Additional details or context for the task."
        }
      },
      required: ["title"]
    }
  },
  {
    name: "list_drive_files",
    description: "List files and folders from the user's Google Drive.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        pageSize: {
          type: Type.NUMBER,
          description: "Number of files to list. Maximum 20."
        }
      }
    }
  },
  {
    name: "search_drive_files",
    description: "Search the user's Google Drive using a query string (e.g. 'title contains report').",
    parameters: {
      type: Type.OBJECT,
      properties: {
        q: {
          type: Type.STRING,
          description: "The Drive API query string."
        }
      },
      required: ["q"]
    }
  },
  {
    name: "get_drive_file",
    description: "Get metadata and download link for a specific file in Google Drive.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileId: {
          type: Type.STRING,
          description: "The Drive file ID."
        }
      },
      required: ["fileId"]
    }
  },
  {
    name: "send_gmail_message",
    description: "Send an email message via Gmail on behalf of the user. Confirm the recipient, subject, and body with the user before sending — this is a destructive action.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        to: {
          type: Type.STRING,
          description: "Recipient email address."
        },
        subject: {
          type: Type.STRING,
          description: "Email subject line."
        },
        body: {
          type: Type.STRING,
          description: "Email body content in plain text."
        }
      },
      required: ["to", "subject", "body"]
    }
  },
  {
    name: "get_gmail_message",
    description: "Get the full body and headers of a specific Gmail message by ID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        messageId: { type: Type.STRING, description: "The Gmail message ID." }
      },
      required: ["messageId"]
    }
  },
  {
    name: "trash_gmail_message",
    description: "Move a specific Gmail message to the Trash by ID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        messageId: { type: Type.STRING, description: "The Gmail message ID." }
      },
      required: ["messageId"]
    }
  },
  {
    name: "delete_gmail_message",
    description: "Permanently delete a specific Gmail message by ID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        messageId: { type: Type.STRING, description: "The Gmail message ID to delete permanently." }
      },
      required: ["messageId"]
    }
  },
  {
    name: "modify_gmail_message",
    description: "Add or remove labels (like UNREAD, STARRED, INBOX) on a specific Gmail message by ID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        messageId: { type: Type.STRING, description: "The Gmail message ID." },
        addLabelIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Labels to add, e.g. ['STARRED']." },
        removeLabelIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Labels to remove, e.g. ['UNREAD']." }
      },
      required: ["messageId"]
    }
  },
  {
    name: "create_gmail_draft",
    description: "Create a draft email message.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        to: { type: Type.STRING, description: "Recipient email address." },
        subject: { type: Type.STRING, description: "Email subject line." },
        body: { type: Type.STRING, description: "Plain text draft body content." }
      },
      required: ["to", "subject", "body"]
    }
  },
  {
    name: "create_drive_file",
    description: "Create a new file or folder in Google Drive.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "The name of the file or folder." },
        mimeType: { type: Type.STRING, description: "The mime type, e.g. 'application/vnd.google-apps.folder' for folders, or 'text/plain'." },
        parents: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Optional parent folder ID list." },
        content: { type: Type.STRING, description: "Plain text content to write if creating a text file." }
      },
      required: ["name", "mimeType"]
    }
  },
  {
    name: "update_drive_file_content",
    description: "Update the plain text content of an existing Google Drive file.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileId: { type: Type.STRING, description: "The Drive file ID." },
        content: { type: Type.STRING, description: "The new plain text content." }
      },
      required: ["fileId", "content"]
    }
  },
  {
    name: "delete_drive_file",
    description: "Delete or trash a specific file or folder in Google Drive.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileId: { type: Type.STRING, description: "The Drive file ID." },
        trash: { type: Type.BOOLEAN, description: "If true (default), moves file to trash. If false, deletes permanently." }
      },
      required: ["fileId"]
    }
  },
  {
    name: "list_google_contacts",
    description: "List the user's Google Contacts with details.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        pageSize: { type: Type.NUMBER, description: "Maximum contacts to fetch. Maximum 100." }
      }
    }
  },
  {
    name: "create_google_contact",
    description: "Create a new contact in Google Contacts.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        firstName: { type: Type.STRING, description: "First name." },
        lastName: { type: Type.STRING, description: "Last name." },
        email: { type: Type.STRING, description: "Email address." },
        phone: { type: Type.STRING, description: "Phone number." }
      },
      required: ["firstName"]
    }
  },
  {
    name: "update_google_contact",
    description: "Update details of an existing Google Contact.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        resourceName: { type: Type.STRING, description: "The contact resource name, e.g. 'people/c123456'." },
        firstName: { type: Type.STRING, description: "New first name." },
        lastName: { type: Type.STRING, description: "New last name." },
        email: { type: Type.STRING, description: "New email address." },
        phone: { type: Type.STRING, description: "New phone number." }
      },
      required: ["resourceName"]
    }
  },
  {
    name: "delete_google_contact",
    description: "Delete an existing Google Contact.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        resourceName: { type: Type.STRING, description: "The contact resource name, e.g. 'people/c123456'." }
      },
      required: ["resourceName"]
    }
  },
  {
    name: "create_calendar_event",
    description: "Create a new event in the user's primary Google Calendar.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING, description: "Event title." },
        description: { type: Type.STRING, description: "Event description." },
        start: { type: Type.STRING, description: "Start time in ISO RFC3339 format, e.g. '2026-06-01T10:00:00Z'." },
        end: { type: Type.STRING, description: "End time in ISO RFC3339 format, e.g. '2026-06-01T11:00:00Z'." },
        location: { type: Type.STRING, description: "Event location." }
      },
      required: ["summary", "start", "end"]
    }
  },
  {
    name: "update_calendar_event",
    description: "Update details of an existing Google Calendar event.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        eventId: { type: Type.STRING, description: "The calendar event ID." },
        summary: { type: Type.STRING, description: "New event title." },
        description: { type: Type.STRING, description: "New event description." },
        start: { type: Type.STRING, description: "New start time in ISO RFC3339 format." },
        end: { type: Type.STRING, description: "New end time in ISO RFC3339 format." },
        location: { type: Type.STRING, description: "New location." }
      },
      required: ["eventId"]
    }
  },
  {
    name: "delete_calendar_event",
    description: "Delete an existing Google Calendar event.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        eventId: { type: Type.STRING, description: "The calendar event ID." }
      },
      required: ["eventId"]
    }
  },
  {
    name: "update_google_task",
    description: "Update details or complete a Google Task.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskId: { type: Type.STRING, description: "The task ID." },
        title: { type: Type.STRING, description: "New task title." },
        notes: { type: Type.STRING, description: "New task notes." },
        status: { type: Type.STRING, description: "Task status: 'completed' to complete task, or 'needsAction'." }
      },
      required: ["taskId"]
    }
  },
  {
    name: "delete_google_task",
    description: "Delete a Google Task by ID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskId: { type: Type.STRING, description: "The task ID." }
      },
      required: ["taskId"]
    }
  }
];

export const googleTokenRequiredTools = new Set([
  'list_gmail_messages',
  'list_calendar_events',
  'list_google_tasks',
  'search_youtube',
  'create_google_task',
  'list_drive_files',
  'search_drive_files',
  'get_drive_file',
  'send_gmail_message',
  'get_gmail_message',
  'trash_gmail_message',
  'delete_gmail_message',
  'modify_gmail_message',
  'create_gmail_draft',
  'create_drive_file',
  'update_drive_file_content',
  'delete_drive_file',
  'list_google_contacts',
  'create_google_contact',
  'update_google_contact',
  'delete_google_contact',
  'create_calendar_event',
  'update_calendar_event',
  'delete_calendar_event',
  'update_google_task',
  'delete_google_task',
  'execute_google_service',
]);

export const additionalToolDeclarations: FunctionDeclaration[] = [
  {
    name: "execute_google_service",
    description: "Execute a generic action on other Google services if specific tools do not match.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        serviceName: { type: Type.STRING, description: "The service name." },
        action: { type: Type.STRING, description: "The specific request." },
        details: { type: Type.OBJECT, description: "Relevant parameters." }
      },
      required: ["serviceName", "action"]
    }
  },
  {
    name: "whatsapp_action",
    description: "Execute real WhatsApp operations via the WhatsApp backend (whatsapp.eburon.ai). Call this when the user asks you to read their chats, send a message, find a contact, or do anything on WhatsApp. The user asking IS permission — execute immediately. Only actions the user has enabled in their permission toggles will work.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "The WhatsApp action: sendMessage, readChats, getContacts, addContact, getGroups, sendGroupMessage, readGroupChat, getMessageHistory. IMPORTANT: For getContacts, 'getContacts' returns contacts with TWO name fields for each person: 'name' is what the user saved the contact as in their phonebook, and 'notify' is the contact's own public WhatsApp profile name (what they chose for themselves). Always show BOTH names when listing contacts. For readChats and getMessageHistory: messages include a 'fromMe' field — true means the user sent it, false means the other person sent it." },
        to: { type: Type.STRING, description: "Recipient phone number or JID (for sendMessage, addContact, getMessageHistory)" },
        text: { type: Type.STRING, description: "Message text (for sendMessage, sendGroupMessage). IMPORTANT — Before sending, you MUST first call getMessageHistory to read the user's WhatsApp History (their real WhatsApp conversations from the WhatsApp server — NOT the BeatriceAppConversations History). Look for messages with fromMe:true — those are the user's own outgoing WhatsApp messages. Analyze their real WhatsApp style: tone, abbreviations, emoji, punctuation, caps, language mixing, length, and how they talk to that person. Then write in THAT exact style. NEVER write in your own voice — become the user's WhatsApp voice." },
        name: { type: Type.STRING, description: "Contact/group name (for addContact, getMessageHistory). For addContact: Baileys/WhatsApp Web does NOT support adding contacts — it will return an error. Tell the user to save the contact on their phone instead." },
        number: { type: Type.STRING, description: "Contact phone number (for addContact)" },
        chatId: { type: Type.STRING, description: "Chat JID or phone number (for getMessageHistory, readGroupChat)" },
        groupId: { type: Type.STRING, description: "Group JID ending in @g.us (for sendGroupMessage, readGroupChat)" },
        groupName: { type: Type.STRING, description: "Group identifier if the exact group JID is known" },
        contactId: { type: Type.STRING, description: "Contact JID or phone number (for getMessageHistory)" },
        limit: { type: Type.NUMBER, description: "Maximum records to return. Maximum 50." }
      },
      required: ["action"]
    }
  },
  {
    name: "dial_contact",
    description: "Dial a phone number from the user's phonebook using the native phone dialer. This opens the system phone app with the number pre-filled so the user can tap to call. Use this when the user asks you to call someone (e.g., while driving, hands-free). Requires make_calls permission enabled in settings.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        contactName: { type: Type.STRING, description: "The contact's name as saved in the user's phonebook (for display purposes)" },
        phoneNumber: { type: Type.STRING, description: "The phone number to dial, in international format (e.g., +639123456789). Use getContacts to look up the number if needed." }
      },
      required: ["contactName", "phoneNumber"]
    }
  },
  {
    name: "whatsapp_call",
    description: "Initiate a WhatsApp voice or video call to a contact. Opens WhatsApp with the call screen for the specified contact. Use this when the user asks you to call someone on WhatsApp (e.g., 'WhatsApp John', 'video call my mom on WhatsApp'). First use getContacts to look up the number. Requires make_whatsapp_calls permission enabled in settings. NOTE: Works on mobile devices where WhatsApp is installed. On desktop, it will open a WhatsApp chat fallback page.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        contactName: { type: Type.STRING, description: "The contact's name as saved in the user's phonebook (for display)" },
        phoneNumber: { type: Type.STRING, description: "The phone number in international format (e.g., +639123456789)" },
        callType: { type: Type.STRING, description: "Type of call: 'voice' for WhatsApp voice call, 'video' for WhatsApp video call. Defaults to 'voice'." }
      },
      required: ["contactName", "phoneNumber"]
    }
  },
  {
    name: "create_document",
    description: "Create a professional web artifact document using Ollama Cloud and the /public sample templates as references. Use this for contracts, reports, letters, invoices, proposals, forms, dashboards, certificates, NDAs, receipts, purchase orders, meeting minutes, memos, and written/visual materials. Never mention HTML to the user.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "Document title displayed to the user." },
        prompt: { type: Type.STRING, description: "Detailed document instructions, content, fields, tone, parties, layout, and required behavior." },
        templateName: {
          type: Type.STRING,
          description: "Optional template family: contract, invoice, letter, proposal, minutes, memo, purchase-order, receipt, resignation, nda, certificate."
        }
      },
      required: ["title", "prompt"]
    }
  },
  {
    name: "generate_image",
    description: "Generate a beautiful high-quality image via the Gemini API. Use this when the user asks you to create, generate, draw, or paint an image. IMPORTANT: You must act as a prompt engineer and expand the user's short request into a highly detailed, descriptive, and imaginative prompt (at least 2-3 sentences) describing lighting, style, and composition to get the best visual result.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: { type: Type.STRING, description: "Your expanded, highly detailed description of the image to generate (minimum 2-3 sentences)." },
        aspectRatio: { type: Type.STRING, description: "Aspect ratio, one of '1:1', '3:4', '4:3', '9:16', '16:9'. Default is '1:1'." }
      },
      required: ["prompt"]
    }
  },
  {
    name: "validate_vat_number",
    description: "Instantly verify a Belgian or EU VAT number via the VIES system. Returns company name, address, and active status if valid. You can use this for KBO/BCE company lookup by passing the company number with BE country code.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        countryCode: { type: Type.STRING, description: "2-letter country code (e.g., BE for Belgium)" },
        vatNumber: { type: Type.STRING, description: "The VAT number without the country prefix" }
      },
      required: ["countryCode", "vatNumber"]
    }
  },
  {
    name: "check_train_route",
    description: "Use the iRail API to find real-time train connections in Belgium (SNCB/NMBS). Include delays, departure times, and track numbers.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        from: { type: Type.STRING, description: "Departure station name (e.g., 'Brussels-Central')" },
        to: { type: Type.STRING, description: "Arrival station name (e.g., 'Antwerp-Central')" }
      },
      required: ["from", "to"]
    }
  },
  {
    name: "calculate_registration_tax",
    description: "Calculate the real estate Registration Tax (Actes/Registratierechten) in Belgium based on the region and purchase price.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        region: { type: Type.STRING, description: "The region: 'flanders', 'wallonia', or 'brussels'" },
        price: { type: Type.NUMBER, description: "The purchase price of the property in Euros" },
        firstTimeBuyer: { type: Type.BOOLEAN, description: "Is this the user's first and only family home?" }
      },
      required: ["region", "price", "firstTimeBuyer"]
    }
  },
  {
    name: "check_tax_deadlines",
    description: "Returns the typical upcoming Belgian tax deadlines (VAT, corporate, personal income, and social security) based on the current date.",
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: "generate_peppol_invoice_xml",
    description: "Drafts a Peppol BIS Billing 3.0 UBL XML invoice file to the workspace. Use this when the user asks to send a Peppol e-invoice.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        supplierName: { type: Type.STRING },
        supplierVat: { type: Type.STRING },
        customerName: { type: Type.STRING },
        customerVat: { type: Type.STRING },
        amount: { type: Type.NUMBER },
        description: { type: Type.STRING }
      },
      required: ["supplierName", "customerName", "amount", "description"]
    }
  },
  {
    name: "connect_google_account",
    description: "Open the Google sign-in popup to connect or reconnect Beatrice to your Google services. Use this when the user says they want to connect Google, when an earlier tool call returned an auth error, or when the current auth status shows NOT AUTHENTICATED and the user wants to fix it. This pops a Google OAuth window asking the user to grant access to Gmail, Calendar, Drive, Tasks, YouTube, and Contacts. Only call this if the user explicitly agrees to re-authenticate.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING, description: "Brief explanation to show the user why the re-connection is needed, e.g. 'token expired' or 'first-time setup'." }
      },
      required: ["reason"]
    }
  },
  {
    name: "search_flights",
    description: "Search for flights between two cities on a specific date for a given number of passengers. Returns a list of flight offers including price, duration, and airline.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        origin: { type: Type.STRING, description: "IATA airport code for origin (e.g. 'MNL' for Manila, 'LHR' for London)." },
        destination: { type: Type.STRING, description: "IATA airport code for destination (e.g. 'NRT' for Tokyo, 'CDG' for Paris)." },
        departureDate: { type: Type.STRING, description: "Departure date in YYYY-MM-DD format." },
        passengers: { type: Type.NUMBER, description: "Number of adult passengers." }
      },
      required: ["origin", "destination", "departureDate", "passengers"]
    }
  },
  {
    name: "book_flight",
    description: "Book a flight using a specific flight offer ID. Requires passenger details (name, date of birth, passport info). This is a destructive action — confirm the offer and passenger details with the user first.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        offerId: { type: Type.STRING, description: "The unique ID of the flight offer to book." },
        passengerDetails: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              first_name: { type: Type.STRING },
              last_name: { type: Type.STRING },
              date_of_birth: { type: Type.STRING, description: "YYYY-MM-DD" },
              passport_number: { type: Type.STRING },
              passport_country: { type: Type.STRING, description: "ISO 3166-1 alpha-2 country code." }
            },
            required: ["first_name", "last_name"]
          }
        }
      },
      required: ["offerId", "passengerDetails"]
    }
  }
];
