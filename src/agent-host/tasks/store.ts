/**
 * Per-project task board.
 *
 * Tasks live in `<project>/.pi/tasks.json`, next to the rest of the project's pi
 * state, so they travel with the repository rather than the desktop's config.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { readJsonFile, writeJsonFileAtomic } from "../json-file";

export const TASK_STATUSES = ["todo", "doing", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task {
  id: string;
  title: string;
  notes?: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  /** Session that created the task, when it came from an agent. */
  sessionId?: string;
}

export interface TaskFile {
  version: 1;
  tasks: Task[];
}

const EMPTY: TaskFile = { version: 1, tasks: [] };

export function tasksFilePath(cwd: string): string {
  return path.join(cwd, CONFIG_DIR_NAME, "tasks.json");
}

function isStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}

/** Read the board, dropping anything that is not a well-formed task. */
export function readTasks(cwd: string): Task[] {
  const file = readJsonFile<TaskFile>(tasksFilePath(cwd), EMPTY);
  if (!Array.isArray(file.tasks)) return [];
  return file.tasks
    .filter((task): task is Task => Boolean(task) && typeof task.id === "string" && typeof task.title === "string")
    .map((task) => ({ ...task, status: isStatus(task.status) ? task.status : "todo" }));
}

export function writeTasks(cwd: string, tasks: Task[]): void {
  writeJsonFileAtomic(tasksFilePath(cwd), { version: 1, tasks } satisfies TaskFile);
}

export interface AddTaskInput {
  title: string;
  notes?: string;
  status?: TaskStatus;
  sessionId?: string;
}

export function addTask(cwd: string, input: AddTaskInput): Task {
  const now = new Date().toISOString();
  const task: Task = {
    id: randomUUID(),
    title: input.title.trim(),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    status: isStatus(input.status) ? input.status : "todo",
    createdAt: now,
    updatedAt: now,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  };
  writeTasks(cwd, [...readTasks(cwd), task]);
  return task;
}

export interface UpdateTaskInput {
  id: string;
  title?: string;
  notes?: string;
  status?: TaskStatus;
}

/** Update one task. Returns the updated task, or null when the id is unknown. */
export function updateTask(cwd: string, input: UpdateTaskInput): Task | null {
  const tasks = readTasks(cwd);
  const index = tasks.findIndex((task) => task.id === input.id);
  if (index === -1) return null;

  const current = tasks[index];
  const next: Task = {
    ...current,
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    ...(input.notes !== undefined ? { notes: input.notes.trim() || undefined } : {}),
    ...(isStatus(input.status) ? { status: input.status } : {}),
    updatedAt: new Date().toISOString(),
  };
  if (next.notes === undefined) delete next.notes;
  tasks[index] = next;
  writeTasks(cwd, tasks);
  return next;
}

export function removeTask(cwd: string, id: string): boolean {
  const tasks = readTasks(cwd);
  const next = tasks.filter((task) => task.id !== id);
  if (next.length === tasks.length) return false;
  writeTasks(cwd, next);
  return true;
}

/** Whether this directory already has a board (used to avoid creating one). */
export function hasTaskBoard(cwd: string): boolean {
  return existsSync(tasksFilePath(cwd));
}
