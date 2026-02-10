/**
 * Chat Input Component
 * Textarea with send button and image upload support.
 * Enter to send, Shift+Enter for new line.
 * Supports: file picker, clipboard paste, drag & drop.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Square, ImagePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export interface ChatAttachment {
  type: 'image';
  mimeType: string;
  fileName: string;
  content: string; // base64
  preview: string; // data URL for display
}

interface ChatInputProps {
  onSend: (text: string, attachments?: ChatAttachment[]) => void;
  onStop?: () => void;
  disabled?: boolean;
  sending?: boolean;
}

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

function fileToAttachment(file: File): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      reject(new Error(`Unsupported image type: ${file.type}`));
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      reject(new Error('Image too large (max 10MB)'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Extract base64 content (remove "data:image/png;base64," prefix)
      const base64 = dataUrl.split(',')[1];
      resolve({
        type: 'image',
        mimeType: file.type,
        fileName: file.name,
        content: base64,
        preview: dataUrl,
      });
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function ChatInput({ onSend, onStop, disabled = false, sending = false }: ChatInputProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type));
    if (fileArray.length === 0) return;

    try {
      const newAttachments = await Promise.all(fileArray.map(fileToAttachment));
      setAttachments((prev) => [...prev, ...newAttachments]);
    } catch (err) {
      console.error('Failed to process image:', err);
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const canSend = (input.trim() || attachments.length > 0) && !disabled && !sending;
  const canStop = sending && !disabled && !!onStop;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    onSend(input.trim(), attachments.length > 0 ? attachments : undefined);
    setInput('');
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, attachments, canSend, onSend]);

  const handleStop = useCallback(() => {
    if (!canStop) return;
    onStop?.();
  }, [canStop, onStop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Handle paste (Ctrl/Cmd+V with image)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        addFiles(imageFiles);
      }
    },
    [addFiles],
  );

  // Handle drag & drop
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer?.files) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  return (
    <div
      className="bg-background p-4"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="max-w-4xl mx-auto">
        {/* Image Previews */}
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {attachments.map((att, idx) => (
              <div
                key={idx}
                className="relative group w-16 h-16 rounded-lg overflow-hidden border border-border"
              >
                <img
                  src={att.preview}
                  alt={att.fileName}
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => removeAttachment(idx)}
                  className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input Row */}
        <div className={`flex items-end gap-2 ${dragOver ? 'ring-2 ring-primary rounded-lg' : ''}`}>
          {/* Image Upload Button */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 h-[44px] w-[44px] text-muted-foreground hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            title="Attach image"
          >
            <ImagePlus className="h-5 w-5" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) {
                addFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />

          {/* Textarea */}
          <div className="flex-1 relative">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              onPaste={handlePaste}
              placeholder={disabled ? 'Gateway not connected...' : 'Message (Enter to send, Shift+Enter for new line)'}
              disabled={disabled}
              className="min-h-[44px] max-h-[200px] resize-none pr-4"
              rows={1}
            />
          </div>

          {/* Send Button */}
          <Button
            onClick={sending ? handleStop : handleSend}
            disabled={sending ? !canStop : !canSend}
            size="icon"
            className="shrink-0 h-[44px] w-[44px]"
            variant={sending ? 'destructive' : 'default'}
            title={sending ? 'Stop' : 'Send'}
          >
            {sending ? (
              <Square className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
