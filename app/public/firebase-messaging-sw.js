/* global firebase */

importScripts(
  'https://www.gstatic.com/firebasejs/12.17.0/firebase-app-compat.js',
)
importScripts(
  'https://www.gstatic.com/firebasejs/12.17.0/firebase-messaging-compat.js',
)

firebase.initializeApp({
  apiKey: 'AIzaSyCbrNabwZF8gvgCS3NDh2YtttHdNXZ3iwo',
  authDomain: 'college-pickem-a1056.firebaseapp.com',
  projectId: 'college-pickem-a1056',
  storageBucket: 'college-pickem-a1056.firebasestorage.app',
  messagingSenderId: '784240916841',
  appId: '1:784240916841:web:d5fb607ea7dc77bb2865f8',
})

firebase.messaging()
