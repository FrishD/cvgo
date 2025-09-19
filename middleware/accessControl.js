// middleware/accessControl.js - Subscription & Feature Access Control
const { Subscription } = require('../models');

// Feature definitions with pricing and restrictions
const FEATURES = {
    'candidates': {
        name: 'חיפוש מועמדים',
        price: 299,
        period: 'month',
        requiresRecruitmentAgency: true,
        description: 'גישה למאגר המועמדים והתאמות אוטומטיות'
    },
    'students': {
        name: 'סטודנטים',
        price: 199,
        period: 'month',
        requiresRecruitmentAgency: false,
        description: 'גישה למאגר הסטודנטים'
    },
    'executives': {
        name: 'בכירים',
        price: 499,
        period: 'month',
        requiresRecruitmentAgency: true,
        description: 'גישה למאגר הבכירים'
    },
    'job-posting': {
        name: 'פרסום משרות',
        price: 199,
        period: 'job',
        requiresRecruitmentAgency: false,
        description: 'פרסום משרות בפלטפורמות מובילות'
    },
    'full-service': {
        name: 'שירות מלא',
        price: 899,
        period: 'month',
        requiresRecruitmentAgency: true,
        description: 'פתרון מקיף לחברות ביוס ומשאבי אנוש'
    }
};

// Free features (always accessible)
const FREE_FEATURES = [
    'home',
    'pricing',
    'settings',
    'company-management'
];

// Check if user has active subscription for specific feature
const hasActiveSubscription = async (companyId, featureId) => {
    try {

        const subscription = await Subscription.findOne({
            companyId: companyId,
            status: 'active',
            features: featureId // מחפש בדיוק את הפיצ’ר בתוך המערך
        });

        return !!subscription;
    } catch (error) {
        console.error('Subscription check error:', error);
        return false;
    }
};



// Check if company is approved recruitment agency
const isApprovedRecruitmentAgency = (company) => {
    return company.isRecruitmentAgency && company.isRecruitmentAccess === 'approved';
};

// Main access control middleware
const requireFeatureAccess = (featureId) => {
    return async (req, res, next) => {
        try {
            // Always allow free features
            if (FREE_FEATURES.includes(featureId)) {
                return next();
            }

            // Check if feature exists
            const feature = FEATURES[featureId];
            if (!feature) {
                return res.status(400).json({
                    error: 'תכונה לא קיימת',
                    code: 'INVALID_FEATURE'
                });
            }

            // Check if feature requires recruitment agency approval
            if (feature.requiresRecruitmentAgency && !isApprovedRecruitmentAgency(req.company)) {
                return res.status(403).json({
                    error: 'תכונה זו זמינה רק לחברות השמה מאושרות',
                    code: 'RECRUITMENT_AGENCY_REQUIRED',
                    feature: {
                        name: feature.name,
                        requiresApproval: true
                    },
                    redirectTo: '/pricing'
                });
            }

            // Check active subscription
            const hasAccess = await hasActiveSubscription(req.company._id, featureId);
            if (!hasAccess) {
                return res.status(402).json({
                    error: 'נדרש מנוי פעיל לתכונה זו',
                    code: 'SUBSCRIPTION_REQUIRED',
                    feature: {
                        id: featureId,
                        name: feature.name,
                        price: feature.price,
                        period: feature.period,
                        description: feature.description
                    },
                    redirectTo: '/pricing'
                });
            }

            next();
        } catch (error) {
            console.error('Feature access check error:', error);
            res.status(500).json({
                error: 'שגיאה בבדיקת הרשאות גישה',
                code: 'ACCESS_CHECK_ERROR'
            });
        }
    };
};

// Get user's accessible features
const getUserAccessibleFeatures = async (companyId, company) => {
    try {
        const accessibleFeatures = [...FREE_FEATURES];

        // Check each paid feature
        for (const [featureId, feature] of Object.entries(FEATURES)) {
            // Skip if requires recruitment agency and company isn't approved
            if (feature.requiresRecruitmentAgency && !isApprovedRecruitmentAgency(company)) {
                continue;
            }

            // Check subscription
            const hasAccess = await hasActiveSubscription(companyId, featureId);
            if (hasAccess) {
                accessibleFeatures.push(featureId);
            }
        }

        return accessibleFeatures;
    } catch (error) {
        console.error('Error getting accessible features:', error);
        return FREE_FEATURES;
    }
};

// Get feature pricing and restrictions info
const getFeatureInfo = (featureId) => {
    const feature = FEATURES[featureId];
    if (!feature) return null;

    return {
        id: featureId,
        name: feature.name,
        price: feature.price,
        period: feature.period,
        description: feature.description,
        requiresRecruitmentAgency: feature.requiresRecruitmentAgency
    };
};

// Get all available features for company
const getAvailableFeatures = (company) => {
    const isRecruitmentAgency = isApprovedRecruitmentAgency(company);

    return Object.entries(FEATURES).reduce((available, [featureId, feature]) => {
        // Skip features that require recruitment agency if company isn't approved
        if (feature.requiresRecruitmentAgency && !isRecruitmentAgency) {
            return available;
        }

        available[featureId] = {
            id: featureId,
            name: feature.name,
            price: feature.price,
            period: feature.period,
            description: feature.description,
            requiresRecruitmentAgency: feature.requiresRecruitmentAgency
        };

        return available;
    }, {});
};

// Middleware to add feature access info to requests
const addFeatureAccessInfo = async (req, res, next) => {
    if (req.user && req.company) {
        try {
            req.accessibleFeatures = await getUserAccessibleFeatures(req.company._id, req.company);
            req.availableFeatures = getAvailableFeatures(req.company);
            req.isApprovedRecruitmentAgency = isApprovedRecruitmentAgency(req.company);
        } catch (error) {
            console.error('Error adding feature access info:', error);
        }
    }
    next();
};

// API endpoint to check feature access
const checkFeatureAccess = async (req, res) => {
    try {
        const { featureId } = req.params;

        if (!req.user || !req.company) {
            return res.status(401).json({ error: 'לא מחובר למערכת' });
        }

        // Always allow free features
        if (FREE_FEATURES.includes(featureId)) {
            return res.json({ hasAccess: true, feature: { id: featureId } });
        }

        const feature = FEATURES[featureId];
        if (!feature) {
            return res.status(400).json({ error: 'תכונה לא קיימת' });
        }

        // Check recruitment agency requirement
        if (feature.requiresRecruitmentAgency && !isApprovedRecruitmentAgency(req.company)) {
            return res.json({
                hasAccess: false,
                reason: 'RECRUITMENT_AGENCY_REQUIRED',
                message: 'תכונה זו זמינה רק לחברות השמה מאושרות',
                feature: {
                    id: featureId,
                    name: feature.name,
                    requiresApproval: true
                }
            });
        }

        // Check subscription
        const hasAccess = await hasActiveSubscription(req.company._id, featureId);

        res.json({
            hasAccess,
            reason: hasAccess ? null : 'SUBSCRIPTION_REQUIRED',
            message: hasAccess ? null : 'נדרש מנוי פעיל לתכונה זו',
            feature: {
                id: featureId,
                name: feature.name,
                price: feature.price,
                period: feature.period,
                description: feature.description
            }
        });
    } catch (error) {
        console.error('Feature access check error:', error);
        res.status(500).json({ error: 'שגיאה בבדיקת גישה' });
    }
};

module.exports = {
    requireFeatureAccess,
    getUserAccessibleFeatures,
    getFeatureInfo,
    getAvailableFeatures,
    addFeatureAccessInfo,
    isApprovedRecruitmentAgency,
    checkFeatureAccess,
    FEATURES,
    FREE_FEATURES
};