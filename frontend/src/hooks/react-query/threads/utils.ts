import { createClient } from "@/lib/supabase/client";

export type Thread = {
    thread_id: string;
    project_id?: string | null;
    is_public?: boolean;
    created_at: string;
    updated_at: string;
    metadata?: {
      workflow_id?: string;
      workflow_name?: string;
      workflow_run_name?: string;
      is_workflow_execution?: boolean;
      agent_id?: string;
    
      [key: string]: any;
    };
    [key: string]: any;
  };
  
  export type ProjectRuntime = {
    mode: 'cloud';
    runtime_ref: string;
  };

  export type Project = {
    id: string;
    name: string;
    description: string;
    created_at: string;
    updated_at?: string;
    runtime?: ProjectRuntime;
    sandbox?: {
      vnc_preview?: string;
      sandbox_url?: string;
      id?: string;
      pass?: string;
    };
    is_public?: boolean;
    [key: string]: any;
  };
  

  export const getThread = async (threadId: string): Promise<Thread> => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('threads')
      .select('*')
      .eq('thread_id', threadId)
      .single();
  
    if (error) throw error;
  
    return data;
  };

export const updateThread = async (
    threadId: string,
    data: Partial<Thread>,
  ): Promise<Thread> => {
    const supabase = createClient();
  
    const updateData = { ...data };
  
    // Update the thread
    const { data: updatedThread, error } = await supabase
      .from('threads')
      .update(updateData)
      .eq('thread_id', threadId)
      .select()
      .single();
  
    if (error) {
      console.error('Error updating thread:', error);
      throw new Error(`Error updating thread: ${error.message}`);
    }
  
    return updatedThread;
  };

export const toggleThreadPublicStatus = async (
    threadId: string,
    isPublic: boolean,
  ): Promise<Thread> => {
    return updateThread(threadId, { is_public: isPublic });
};

export const deleteThread = async (threadId: string, sandboxId?: string): Promise<void> => {
    try {
      const supabase = createClient();
      void sandboxId;
      const { error: agentRunsError } = await supabase
        .from('agent_runs')
        .delete()
        .eq('thread_id', threadId);

      if (agentRunsError) {
        console.error('Error deleting agent runs:', agentRunsError);
        throw new Error(`Error deleting agent runs: ${agentRunsError.message}`);
      }
      const { error: messagesError } = await supabase
        .from('messages')
        .delete()
        .eq('thread_id', threadId);

      if (messagesError) {
        console.error('Error deleting messages:', messagesError);
        throw new Error(`Error deleting messages: ${messagesError.message}`);
      }
      const { error: threadError2 } = await supabase
        .from('threads')
        .delete()
        .eq('thread_id', threadId);
  
      if (threadError2) {
        console.error('Error deleting thread:', threadError2);
        throw new Error(`Error deleting thread: ${threadError2.message}`);
      }
    } catch (error) {
      console.error('Error deleting thread and related items:', error);
      throw error;
    }
  };
  

export const getPublicProjects = async (): Promise<Project[]> => {
    try {
      const supabase = createClient();
  
      // Query for threads that are marked as public
      const { data: publicThreads, error: threadsError } = await supabase
        .from('threads')
        .select('project_id')
        .eq('is_public', true);
  
      if (threadsError) {
        console.error('Error fetching public threads:', threadsError);
        return [];
      }
  
      // If no public threads found, return empty array
      if (!publicThreads?.length) {
        return [];
      }
  
      // Extract unique project IDs from public threads
      const publicProjectIds = [
        ...new Set(publicThreads.map((thread) => thread.project_id)),
      ].filter(Boolean);
  
      // If no valid project IDs, return empty array
      if (!publicProjectIds.length) {
        return [];
      }
  
      // Get the projects that have public threads
      const { data: projects, error: projectsError } = await supabase
        .from('projects')
        .select('*')
        .in('project_id', publicProjectIds);
  
      if (projectsError) {
        console.error('Error fetching public projects:', projectsError);
        return [];
      }
  
      // Map database fields to our Project type
      const mappedProjects: Project[] = (projects || []).map((project) => ({
        id: project.project_id,
        name: project.name || '',
        description: project.description || '',
        created_at: project.created_at,
        updated_at: project.updated_at,
        runtime: {
          mode: 'cloud' as const,
          runtime_ref: project.project_id,
        },
        is_public: true, // Mark these as public projects
      }));
  
      return mappedProjects;
    } catch (err) {
      console.error('Error fetching public projects:', err);
      return [];
    }
  };



  export const getProject = async (projectId: string): Promise<Project> => {
    const supabase = createClient();
  
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('project_id', projectId)
        .single();
  
      if (error) {
        // Handle the specific "no rows returned" error from Supabase
        if (error.code === 'PGRST116') {
          throw new Error(`Project not found or not accessible: ${projectId}`);
        }
        throw error;
      }

      // Map database fields to our Project type
      const mappedProject: Project = {
        id: data.project_id,
        name: data.name || '',
        description: data.description || '',
        is_public: data.is_public || false,
        created_at: data.created_at,
        runtime: {
          mode: 'cloud' as const,
          runtime_ref: data.project_id,
        },
      };
  
      return mappedProject;
    } catch (error) {
      console.error(`Error fetching project ${projectId}:`, error);
      throw error;
    }
  };


  export const updateProject = async (
    projectId: string,
    data: Partial<Project>,
  ): Promise<Project> => {
    const supabase = createClient();
    // Sanity check to avoid update errors
    if (!projectId || projectId === '') {
      console.error('Attempted to update project with invalid ID:', projectId);
      throw new Error('Cannot update project: Invalid project ID');
    }
  
    const { data: updatedData, error } = await supabase
      .from('projects')
      .update(data)
      .eq('project_id', projectId)
      .select()
      .single();
  
    if (error) {
      console.error('Error updating project:', error);
      throw error;
    }
  
    if (!updatedData) {
      throw new Error('No data returned from update');
    }
  
    // Dispatch a custom event to notify components about the project change
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('project-updated', {
          detail: {
            projectId,
            updatedData: {
              id: updatedData.project_id,
              name: updatedData.name,
              description: updatedData.description,
            },
          },
        }),
      );
    }
  
    // Return formatted project data - use same mapping as getProject
    return {
      id: updatedData.project_id,
      name: updatedData.name,
      description: updatedData.description || '',
      created_at: updatedData.created_at,
      runtime: {
        mode: 'cloud' as const,
        runtime_ref: updatedData.project_id,
      },
    };
  };
