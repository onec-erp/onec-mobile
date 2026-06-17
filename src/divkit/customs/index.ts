// Register every onec-* custom renderer. Import for side effects once at app
// start (the divkit barrel does this). The 7 types that appear in the mobile
// viewport — the same set the Flutter client implements.
import { registerCustom } from '../registry';
import { onecActionsMenu } from './actionsMenu';
import { onecComments } from './comments';
import { onecForm } from './form';
import { onecHint, onecIcon } from './icon';
import { onecList } from './list';
import { onecWidget } from './widget';

registerCustom('onec-icon', onecIcon);
registerCustom('onec-hint', onecHint);
registerCustom('onec-widget', onecWidget);
registerCustom('onec-list', onecList);
registerCustom('onec-actions-menu', onecActionsMenu);
registerCustom('onec-form', onecForm);
registerCustom('onec-comments', onecComments);
