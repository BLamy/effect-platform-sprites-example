"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BookOpen,
  ExternalLink,
  GitPullRequest,
  Home,
  Play,
  Sparkles,
  Terminal,
  Workflow,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { codeExamples } from "@/lib/sprite-doc-content"

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="@replayio/effect-platform-sprites"
              render={
                <Link href="/">
                  <span className="flex aspect-square size-8 items-center justify-center rounded-lg border bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
                    <Workflow className="size-4" aria-hidden />
                  </span>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      Effect Platform
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      Sprites docs
                    </span>
                  </div>
                </Link>
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === "/"}
                  tooltip="Home"
                  render={
                    <Link href="/">
                      <Home aria-hidden />
                      <span>Home</span>
                    </Link>
                  }
                />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Examples</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {codeExamples.map((example) => {
                const href = `/examples/${example.value}`
                const isActive = pathname === href
                return (
                  <SidebarMenuItem key={example.value}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={example.title}
                      render={
                        <Link href={href}>
                          <Play aria-hidden />
                          <span>{example.title}</span>
                        </Link>
                      }
                    />
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>AI CLI examples</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === "/examples/agent-print"}
                  tooltip="One-shot agent command"
                  render={
                    <Link href="/examples/agent-print">
                      <Sparkles aria-hidden />
                      <span>One-shot agent</span>
                    </Link>
                  }
                />
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === "/examples/agent-interactive"}
                  tooltip="Interactive agent terminal"
                  render={
                    <Link href="/examples/agent-interactive">
                      <Terminal aria-hidden />
                      <span>Interactive agent</span>
                    </Link>
                  }
                />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Bot examples</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === "/examples/pr-comment-bot"}
                  tooltip="PR comment bot"
                  render={
                    <Link href="/examples/pr-comment-bot">
                      <GitPullRequest aria-hidden />
                      <span>PR comment bot</span>
                    </Link>
                  }
                />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Package source on GitHub"
              render={
                <a
                  href="https://github.com/replayio/replay-endpoints/tree/main/packages/effect-platform-sprites"
                  target="_blank"
                  rel="noreferrer"
                >
                  <BookOpen aria-hidden />
                  <span>Package source</span>
                  <ExternalLink
                    className="ml-auto size-3.5 opacity-60"
                    aria-hidden
                  />
                </a>
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
