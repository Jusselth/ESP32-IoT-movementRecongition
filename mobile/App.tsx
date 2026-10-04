import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { AppNavigator } from './src/navigation/AppNavigator';
import { useSystemStore } from './src/store/useSystemStore';

export default function App() {
    const initSocketListeners = useSystemStore((state) => state.initSocketListeners);
    const fetchInitialData = useSystemStore((state) => state.fetchInitialData);

    useEffect(() => {
        initSocketListeners();
        fetchInitialData();
    }, []);

    return (
        <NavigationContainer>
            <StatusBar style="light" />
            <AppNavigator />
        </NavigationContainer>
    );
}