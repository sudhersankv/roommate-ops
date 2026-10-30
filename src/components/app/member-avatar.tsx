import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

/** A Member's initial; with `image` (their Google picture, once connected) the picture, the initial while it loads. */
export function MemberAvatar({
  name,
  image,
  size = "default",
  className,
}: {
  name: string
  image?: string | null
  size?: "sm" | "default" | "lg"
  className?: string
}) {
  return (
    <Avatar size={size} className={className}>
      {image ? <AvatarImage src={image} alt="" referrerPolicy="no-referrer" /> : null}
      <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  )
}
