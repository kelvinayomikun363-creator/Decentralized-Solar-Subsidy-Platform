# 🌞 Decentralized Solar Subsidy Platform

Welcome to a revolutionary Web3 solution for accelerating renewable energy adoption! This project uses the Stacks blockchain and Clarity smart contracts to automate subsidies for rooftop solar installations. Governments or organizations can fund a subsidy pool, and funds are released automatically to homeowners based on verified energy output from their panels. This solves real-world problems like bureaucratic delays in subsidy distribution, fraud in claims, and low adoption rates of solar energy due to upfront costs.

## ✨ Features

🔋 Automated subsidy payouts triggered by real energy production  
💰 Transparent subsidy pool management with community governance  
📊 Oracle-integrated verification of energy output from IoT devices  
🏠 Easy registration for homeowners and certified installers  
⚖️ Dispute resolution for installation or output claims  
📈 Performance tracking and reporting for subsidized installations  
🔒 Secure token-based subsidies to prevent double-dipping  
🌍 Scalable for global use, reducing carbon footprints through incentives

## 🛠 How It Works

**For Homeowners**  
- Register your identity and property details.  
- Hire a certified installer and register the new rooftop solar installation.  
- Connect IoT devices to report energy output to the oracle.  
- Once verified output meets thresholds, subsidies are automatically released from the pool to your wallet.  

**For Funders (e.g., Governments or NGOs)**  
- Deposit funds into the subsidy pool contract.  
- Set parameters like subsidy amounts per kWh via governance votes.  
- Monitor reports on total energy produced and subsidies distributed.  

**For Installers**  
- Get certified through the system.  
- Verify installations on-chain after completion.  
- Earn referral bonuses if installations perform well.  

**Verification Process**  
- Energy data from panels is fed to an oracle contract.  
- Smart contracts cross-check data and release funds only if output is validated.  
- Disputes can be raised and resolved through a decentralized arbitration process.  

That's it! No paperwork, instant payouts, and trustless incentives for going green.

## 📜 Smart Contracts Overview

This project is built with 8 Clarity smart contracts for modularity, security, and scalability:  

1. **UserRegistry.clar**: Handles registration and KYC-like verification for homeowners, installers, and funders. Stores user profiles and roles.  
2. **InstallationRegistry.clar**: Registers new rooftop solar installations, linking them to users and storing details like capacity and location.  
3. **SubsidyPool.clar**: Manages the pool of subsidy funds, allowing deposits, withdrawals (only via automation), and balance queries.  
4. **EnergyOracle.clar**: Integrates with external oracles to receive and validate real-time energy output data from IoT devices.  
5. **PayoutEngine.clar**: Automates subsidy releases based on verified output, calculating amounts per predefined rules (e.g., $ per kWh).  
6. **Governance.clar**: Enables token holders to vote on parameters like subsidy rates, thresholds, or pool allocations.  
7. **DisputeResolution.clar**: Allows users to raise disputes over installations or data, with arbitration via staked votes or jurors.  
8. **Reporting.clar**: Generates on-chain reports on total subsidized energy, payouts, and system performance for transparency.