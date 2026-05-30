import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface UnifiedTranscriptProps {
  userText: string;
  modelText: string;
  userName: string;
  modelName: string;
}

export function UnifiedTranscript({ userText, modelText, userName, modelName }: UnifiedTranscriptProps) {
  // We only show the component if there is at least some text to display
  if (!userText && !modelText) return null;

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-3xl mx-auto gap-3 px-4">
      <AnimatePresence mode="popLayout">
        {userText && (
          <motion.div
            key="user-transcript"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="flex flex-col items-center justify-center text-center"
          >
            <span className="text-[10px] font-bold opacity-50 uppercase tracking-widest text-gray-400 mb-1">
              {userName}
            </span>
            <p className="text-gray-200 text-sm sm:text-base md:text-lg font-medium leading-relaxed drop-shadow-md line-clamp-3 text-ellipsis overflow-hidden">
              {userText}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="popLayout">
        {modelText && (
          <motion.div
            key="model-transcript"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="flex flex-col items-center justify-center text-center"
          >
            <span className="text-[10px] font-bold opacity-50 uppercase tracking-widest text-[#d0a78b] mb-1 mt-2">
              {modelName}
            </span>
            <p className="text-[#d0a78b] text-base sm:text-lg md:text-xl font-medium leading-relaxed drop-shadow-[0_0_15px_rgba(208,167,139,0.3)] line-clamp-3 text-ellipsis overflow-hidden">
              {modelText}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
