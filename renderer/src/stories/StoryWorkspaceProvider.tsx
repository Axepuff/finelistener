import React, { useEffect } from 'react';
import { AppContext } from '../AppContext';
import type { StoryWorkspace } from './storyWorkspace';

interface Props {
    workspace: StoryWorkspace;
    children: React.ReactNode;
}

export const StoryWorkspaceProvider: React.FC<Props> = ({ workspace, children }) => {
    useEffect(() => () => { workspace.dispose(); }, [workspace]);

    return <AppContext value={workspace.store}>{children}</AppContext>;
};
