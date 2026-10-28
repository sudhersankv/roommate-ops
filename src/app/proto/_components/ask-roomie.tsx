"use client"

import { useRef, useState } from "react"
import { ArrowUpIcon } from "lucide-react"

import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { RoomieAvatar } from "./roomie-avatar"
import { cannedReplies, chat, type ChatMessage } from "../_data"
import { useStore } from "../_lib/store"

const suggestions = ["Who owes what?", "Whose turn is trash?", "What's in the Cart?"]

export function AskRoomie() {
  const { state, setAskOpen } = useStore()
  return (
    <Drawer open={state.askOpen} onOpenChange={setAskOpen}>
      <DrawerContent className="mx-auto max-w-md [--drawer-height:88dvh]">
        <DrawerHeader className="flex-row items-center gap-3 border-b pb-4">
          <RoomieAvatar size={44} animated />
          <div className="flex flex-col gap-0.5">
            <DrawerTitle className="type-heading">Ask Roomie</DrawerTitle>
            <DrawerDescription>Same Roomie as in your WhatsApp chat.</DrawerDescription>
          </div>
        </DrawerHeader>
        <Conversation />
      </DrawerContent>
    </Drawer>
  )
}

function Conversation() {
  const [messages, setMessages] = useState<ChatMessage[]>(chat)
  const [draft, setDraft] = useState("")
  const [typing, setTyping] = useState(false)
  const replyIndex = useRef(0)
  const seq = useRef(0)

  const send = (text: string) => {
    const clean = text.trim()
    if (!clean || typing) return
    setMessages((m) => [...m, { id: `u${++seq.current}`, from: "you", text: clean }])
    setDraft("")
    setTyping(true)
    window.setTimeout(() => {
      const reply = cannedReplies[replyIndex.current++ % cannedReplies.length]
      setMessages((m) => [...m, { id: `r${++seq.current}`, from: "roomie", text: reply }])
      setTyping(false)
    }, 600)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-3 px-4 py-4">
              {messages.map((m) => (
                <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.from === "you"}>
                  <ChatRow message={m} />
                </MessageScrollerItem>
              ))}
              {typing ? (
                <MessageScrollerItem messageId="typing">
                  <Message align="start">
                    <MessageAvatar>
                      <RoomieAvatar />
                    </MessageAvatar>
                    <MessageContent>
                      <Bubble variant="secondary">
                        <BubbleContent>
                          <span className="shimmer" aria-live="polite">
                            Roomie is typing
                          </span>
                        </BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <div className="flex flex-col gap-3 border-t bg-popover px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {suggestions.map((s) => (
            <Button key={s} variant="outline" size="sm" onClick={() => send(s)} disabled={typing}>
              {s}
            </Button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            send(draft)
          }}
        >
          <InputGroup className="rounded-3xl">
            <InputGroupTextarea
              aria-label="Message Roomie"
              placeholder="Message Roomie…"
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  send(draft)
                }
              }}
              className="max-h-32 min-h-11 py-3 pl-4"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton type="submit" variant="default" size="icon-sm" aria-label="Send" disabled={!draft.trim() || typing}>
                <ArrowUpIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </div>
    </div>
  )
}

function ChatRow({ message }: { message: ChatMessage }) {
  if (message.from === "you") {
    return (
      <Message align="end">
        <MessageContent>
          <Bubble variant="default" align="end">
            <BubbleContent>{message.text}</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    )
  }
  return (
    <Message align="start">
      <MessageAvatar>
        <RoomieAvatar />
      </MessageAvatar>
      <MessageContent>
        <Bubble variant="secondary">
          <BubbleContent>{message.text}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
