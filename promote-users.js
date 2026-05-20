const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');

dotenv.config();

const promoteUsers = async () => {
    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            console.error('MONGODB_URI is not defined in .env');
            process.exit(1);
        }

        await mongoose.connect(mongoUri);
        console.log('Connected to MongoDB');

        // 1. Promote or create local admin user 'biospec@123'
        const localUsername = 'biospec@123';
        const localPassword = 'biospec098@123';
        const localEmail = 'biospec@example.com';

        let localUser = await User.findOne({ username: localUsername });
        if (localUser) {
            console.log(`Found existing local user ${localUsername}. Updating password and promoting to admin...`);
            localUser.password = localPassword;
            localUser.role = 'admin';
            if (!localUser.email) {
                localUser.email = localEmail;
            }
            await localUser.save();
        } else {
            // Check if there is already a user with this email to avoid unique constraint failure
            const existingEmailUser = await User.findOne({ email: localEmail });
            if (existingEmailUser) {
                console.log(`User with email ${localEmail} already exists. Updating their username and role...`);
                existingEmailUser.username = localUsername;
                existingEmailUser.password = localPassword;
                existingEmailUser.role = 'admin';
                await existingEmailUser.save();
            } else {
                console.log(`Creating new local user ${localUsername} with admin role...`);
                localUser = new User({
                    username: localUsername,
                    email: localEmail,
                    password: localPassword,
                    role: 'admin'
                });
                await localUser.save();
            }
        }
        console.log(`Local user ${localUsername} is now an admin!`);

        // 2. Promote or create Google OAuth user 'biospectra2006@gmail.com'
        const oauthEmail = 'biospectra2006@gmail.com';
        let oauthUser = await User.findOne({ email: oauthEmail });
        if (oauthUser) {
            console.log(`Found existing Google OAuth user with email ${oauthEmail}. Promoting to admin...`);
            oauthUser.role = 'admin';
            await oauthUser.save();
        } else {
            console.log(`Pre-creating Google OAuth user with email ${oauthEmail} and admin role...`);
            oauthUser = new User({
                username: 'biospectra2006',
                email: oauthEmail,
                role: 'admin',
                isMfaEnabled: false
            });
            // We use a dummy/random password since they sign in via Google OAuth
            oauthUser.password = Math.random().toString(36).slice(-10) + 'A1!';
            await oauthUser.save();
        }
        console.log(`Google OAuth user ${oauthEmail} is now an admin!`);

        console.log('Promotion script completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Error running promotion script:', error);
        process.exit(1);
    }
};

promoteUsers();
