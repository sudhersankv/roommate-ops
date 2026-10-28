import { Avatar, AvatarFallback } from "@/components/ui/avatar"

export function MemberAvatar({
  name,
  size = "default",
  className,
}: {
  name: string
  size?: "sm" | "default" | "lg"
  className?: string
}) {
  return (
    <Avatar size={size} className={className}>
      <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  )
}
