import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ControlScreen } from '../screens/ControlScreen';
import { ScheduleScreen } from '../screens/ScheduleScreen';
import { LogsScreen } from '../screens/LogsScreen';
import { CameraScreen } from '../screens/CameraScreen';

export type RootTabParamList = {
    Control: undefined;
    Schedule: undefined;
    Logs: undefined;
    Camera: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

export const AppNavigator = () => {
    return (
        <Tab.Navigator
            screenOptions={{
                headerStyle: { backgroundColor: '#1e1e1e' },
                headerTintColor: '#ffffff',
                tabBarStyle: { backgroundColor: '#1e1e1e', borderTopColor: '#333' },
                tabBarActiveTintColor: '#00e676',
                tabBarInactiveTintColor: '#888888',
            }}
        >
            <Tab.Screen name="Control" component={ControlScreen} options={{ title: 'Control' }} />
            <Tab.Screen name="Schedule" component={ScheduleScreen} options={{ title: 'Horarios' }} />
            <Tab.Screen name="Logs" component={LogsScreen} options={{ title: 'Historial' }} />
            <Tab.Screen name="Camera" component={CameraScreen} options={{ title: 'Cámara' }} />
        </Tab.Navigator>
    );
};