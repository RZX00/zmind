'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  BookOpen,
  Play,
  ChevronRight,
  Sparkles,
  Rocket,
  Presentation,
  FolderOpen,
  Video,
  PenTool,
  Bot,
  type LucideIcon,
} from 'lucide-react';

import { FooterSection } from '@/components/home/sections/footer-section';
import { Link } from '@/i18n/routing';
import { cn } from '@/lib/utils';

interface Tutorial {
  id: string;
  title: string;
  description: string;
  duration?: string;
  embedCode: string;
  isPlaceholder?: boolean;
  icon: LucideIcon;
}

const tutorials: Tutorial[] = [
  {
    id: 'introduction-to-zmind',
    title: 'Introduction to Zmind',
    description:
      'Get a concise overview of Zmind and learn the core AI-assisted workflows that accelerate your daily execution.',
    duration: '3 min',
    icon: Sparkles,
    embedCode:
      '<div style="position: relative; padding-bottom: calc(57.3684% + 41px); height: 0px; width: 100%;"><iframe src="https://demo.arcade.software/iG83WENBBNvLFbzIf8kE?embed&embed_mobile=tab&embed_desktop=inline&show_copy_link=true" title="Explore Templates and AI-Powered Content Generation Modes" frameborder="0" loading="lazy" webkitallowfullscreen mozallowfullscreen allowfullscreen allow="clipboard-write" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; color-scheme: light;" ></iframe></div>',
  },
  {
    id: 'first-task',
    title: 'Getting Started: Your First Task',
    description:
      'Learn the basic end-to-end path: define a task, run an AI-assisted execution, and inspect the final deliverable.',
    duration: '4 min',
    icon: Rocket,
    embedCode:
      '<div style="position: relative; padding-bottom: calc(57.3684% + 41px); height: 0px; width: 100%;"><iframe src="https://demo.arcade.software/8tC4UfBbqMpsUo6CM30i?embed&embed_mobile=tab&embed_desktop=inline&show_copy_link=true" title="Your first task with Zmind" frameborder="0" loading="lazy" webkitallowfullscreen mozallowfullscreen allowfullscreen allow="clipboard-write" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; color-scheme: light;" ></iframe></div>',
  },
  {
    id: 'presentations',
    title: 'Create and Export Presentations',
    description:
      'Build polished presentations with structured AI guidance and export to share-ready formats.',
    duration: '4 min',
    icon: Presentation,
    embedCode:
      '<div style="position: relative; padding-bottom: calc(57.3684% + 41px); height: 0px; width: 100%;"><iframe src="https://demo.arcade.software/p1ot4ZaAhDZYY61npOrT?embed&embed_mobile=tab&embed_desktop=inline&show_copy_link=true" title="Create a business review presentation" frameborder="0" loading="lazy" webkitallowfullscreen mozallowfullscreen allowfullscreen allow="clipboard-write" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; color-scheme: light;" ></iframe></div>',
  },
  {
    id: 'file-management',
    title: 'Create and Manage Files',
    description:
      'Understand how to generate, organize, and export files from Zmind workflows.',
    duration: '3 min',
    icon: FolderOpen,
    embedCode:
      '<div style="position: relative; padding-bottom: calc(57.3684% + 41px); height: 0px; width: 100%;"><iframe src="https://demo.arcade.software/8augEzFC6kfwzfGxGg7H?embed&embed_mobile=tab&embed_desktop=inline&show_copy_link=true" title="Download market share data to Excel" frameborder="0" loading="lazy" webkitallowfullscreen mozallowfullscreen allowfullscreen allow="clipboard-write" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; color-scheme: light;" ></iframe></div>',
  },
  {
    id: 'media-generation',
    title: 'Generate Videos and Images',
    description:
      'Explore AI media generation for visual storytelling and product-grade output.',
    duration: '3 min',
    icon: Video,
    embedCode:
      '<div style="position: relative; padding-bottom: calc(57.3684% + 41px); height: 0px; width: 100%;"><iframe src="https://demo.arcade.software/0FLRZoBUHFwGEbpIfUnP?embed&embed_mobile=tab&embed_desktop=inline&show_copy_link=true" title="Generate a photorealistic image and video" frameborder="0" loading="lazy" webkitallowfullscreen mozallowfullscreen allowfullscreen allow="clipboard-write" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; color-scheme: light;" ></iframe></div>',
  },
  {
    id: 'canvas-mode',
    title: 'Use Canvas Mode',
    description:
      'Master visual workflow design with canvas-based ideation and structured outputs.',
    duration: '4 min',
    icon: PenTool,
    embedCode:
      '<div style="position: relative; padding-bottom: calc(57.3684% + 41px); height: 0px; width: 100%;"><iframe src="https://demo.arcade.software/ilHFhqxU66uwWw9NEOEI?embed&embed_mobile=tab&embed_desktop=inline&show_copy_link=true" title="Design and export in canvas mode" frameborder="0" loading="lazy" webkitallowfullscreen mozallowfullscreen allowfullscreen allow="clipboard-write" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; color-scheme: light;" ></iframe></div>',
  },
  {
    id: 'custom-workers',
    title: 'Build Custom Workers',
    description:
      'Configure custom worker behavior and integrations for domain-specific automation.',
    duration: '5 min',
    icon: Bot,
    embedCode:
      '<div style="position: relative; padding-bottom: calc(57.3684% + 41px); height: 0px; width: 100%;"><iframe src="https://demo.arcade.software/UCjRrraJVUHYeniHKJHS?embed&embed_mobile=tab&embed_desktop=inline&show_copy_link=true" title="Set up a new AI assistant worker" frameborder="0" loading="lazy" webkitallowfullscreen mozallowfullscreen allowfullscreen allow="clipboard-write" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; color-scheme: light;" ></iframe></div>',
  },
];

function TableOfContents({ tutorials, activeId }: { tutorials: Tutorial[]; activeId: string }) {
  return (
    <nav className="space-y-1">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground">Chapters</h3>
      {tutorials.map((tutorial, index) => (
        <a
          key={tutorial.id}
          href={`#${tutorial.id}`}
          className={cn(
            'flex items-start gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
            activeId === tutorial.id
              ? 'bg-primary/10 font-medium text-primary'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <span
            className={cn(
              'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold',
              activeId === tutorial.id ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground',
            )}
          >
            {index + 1}
          </span>
          <span className="line-clamp-2">{tutorial.title}</span>
        </a>
      ))}
    </nav>
  );
}

function TutorialCard({ tutorial, index }: { tutorial: Tutorial; index: number }) {
  const [isActive, setIsActive] = useState(false);
  const chapterNumber = index + 1;
  const Icon = tutorial.icon;

  return (
    <motion.section
      id={tutorial.id}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="scroll-mt-32"
    >
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-3">
              <span className="text-xs font-medium uppercase tracking-wider text-primary/70">
                Chapter {chapterNumber}
              </span>
              {tutorial.duration ? (
                <span className="rounded-full bg-accent/50 px-2 py-1 text-xs font-medium text-muted-foreground">
                  {tutorial.duration}
                </span>
              ) : null}
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">{tutorial.title}</h2>
            <p className="mt-2 leading-relaxed text-muted-foreground">{tutorial.description}</p>
          </div>
        </div>

        {tutorial.isPlaceholder ? (
          <div className="relative overflow-hidden rounded-xl border border-dashed border-border bg-accent/10">
            <div style={{ paddingBottom: 'calc(57.3684% + 41px)' }} className="flex items-center justify-center">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent/50">
                    <Play className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <p className="font-medium text-muted-foreground">Tutorial video coming soon</p>
                  <p className="mt-1 text-sm text-muted-foreground/70">Check back for updates</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="relative overflow-hidden rounded-xl border border-border bg-accent/20"
            onMouseLeave={() => setIsActive(false)}
          >
            <div
              dangerouslySetInnerHTML={{ __html: tutorial.embedCode }}
              className={cn('transition-opacity', !isActive && 'pointer-events-none')}
            />
            {!isActive ? (
              <div
                className="absolute inset-0 flex cursor-pointer items-center justify-center bg-transparent transition-colors hover:bg-black/5"
                onClick={() => setIsActive(true)}
              >
                <div className="flex items-center gap-2 rounded-full border border-border bg-background/90 px-4 py-2 shadow-sm backdrop-blur-sm">
                  <Play className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">Click to interact</span>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </motion.section>
  );
}

export default function TutorialsPage() {
  const [activeId, setActiveId] = useState(tutorials[0]?.id || '');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      {
        rootMargin: '-20% 0px -60% 0px',
        threshold: 0,
      },
    );

    tutorials.forEach((tutorial) => {
      const element = document.getElementById(tutorial.id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, []);

  return (
    <main className="min-h-screen bg-background">
      <div className="border-b border-border">
        <div className="mx-auto max-w-7xl px-6 pb-12 pt-28 md:px-10 md:pt-32">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="max-w-3xl"
          >
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <BookOpen className="h-6 w-6 text-primary" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Learn Zmind</span>
            </div>
            <h1 className="mb-4 text-3xl font-semibold tracking-tight text-foreground md:text-4xl lg:text-5xl">
              Tutorials
            </h1>
            <p className="text-lg leading-relaxed text-muted-foreground">
              Step-by-step interactive tutorials from onboarding to advanced workflows.
            </p>
          </motion.div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-12 md:px-10 md:py-16">
        <div className="flex gap-12 lg:gap-16">
          <div className="min-w-0 flex-1 space-y-16">
            {tutorials.map((tutorial, index) => (
              <TutorialCard key={tutorial.id} tutorial={tutorial} index={index} />
            ))}

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="rounded-xl border border-dashed border-border p-8 text-center"
            >
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/50">
                <Play className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-lg font-medium text-foreground">More tutorials coming soon</h3>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                We keep adding new hands-on walkthroughs for updated features and advanced techniques.
              </p>
            </motion.div>
          </div>

          <aside className="hidden w-64 flex-shrink-0 lg:block">
            <div className="sticky top-32">
              <TableOfContents tutorials={tutorials} activeId={activeId} />

              <div className="mt-8 border-t border-border pt-8">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground">Resources</h3>
                <div className="space-y-2">
                  <Link
                    href="/docs/introduction"
                    className="flex items-center gap-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ChevronRight className="h-4 w-4" />
                    Documentation
                  </Link>
                  <a
                    href="mailto:team@zmind.so"
                    className="flex items-center gap-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ChevronRight className="h-4 w-4" />
                    Contact us
                  </a>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <FooterSection />
    </main>
  );
}
