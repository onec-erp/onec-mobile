// Register every onec-* custom renderer. Import for side effects once at app
// start (the divkit barrel does this). Covers the full set the web UI package
// implements, so any page the server composes renders natively.
import { registerCustom } from '../registry';
import { onecActions } from './actions';
import { onecActionsMenu } from './actionsMenu';
import { onecComments } from './comments';
import { onecConstants } from './constants';
import { onecForm } from './form';
import { onecGeo } from './geo';
import { onecHint, onecIcon } from './icon';
import { onecList } from './list';
import { onecLoginForm } from './loginForm';
import { onecWidget } from './widget';

registerCustom('onec-icon', onecIcon);
registerCustom('onec-hint', onecHint);
registerCustom('onec-widget', onecWidget);
registerCustom('onec-list', onecList);
registerCustom('onec-actions-menu', onecActionsMenu);
registerCustom('onec-actions', onecActions);
registerCustom('onec-form', onecForm);
registerCustom('onec-comments', onecComments);
registerCustom('onec-constants', onecConstants);
registerCustom('onec-login-form', onecLoginForm);
registerCustom('onec-geo', onecGeo);
