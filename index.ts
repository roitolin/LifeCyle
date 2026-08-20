import { registerRootComponent } from 'expo';
import { configureForegroundPushNotifications } from '@/services/pushNotifications';
import App from './App';

configureForegroundPushNotifications();
registerRootComponent(App);
